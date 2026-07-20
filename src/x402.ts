/** Optional deterministic x424-before-x402 composition. */

import type { RequestHandler } from "express";
import {
  HUMAN_PROOF_HEADER,
  HUMAN_REQUIRED_HEADER,
  requirementFromChallenge,
} from "./http.js";
import {
  assertChallengeRequestMatch,
  isCrossOriginRedirect,
} from "./transport.js";
import type { X424FetchOptions } from "./client.js";
import type { HumanRequirement } from "./types.js";

export const PAYMENT_SIGNATURE_HEADER = "payment-signature" as const;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface PaymentDependencyResolution {
  /** Value produced by an official x402 client/facilitator integration. */
  readonly paymentSignature: string;
  /** Optional official-client settlement/result hook. */
  readonly processResponse?: (response: Response) => Promise<void> | void;
}

export type PaymentDependencyResolver = (input: {
  readonly response: Response;
  readonly request: Request;
}) => Promise<PaymentDependencyResolution>;

export interface X424X402FetchOptions extends X424FetchOptions {
  readonly resolvePaymentDependency: PaymentDependencyResolver;
  /** Required when the request cannot be cloned safely for all three sends. */
  readonly bodyFactory?: (
    attempt: 1 | 2 | 3,
  ) => BodyInit | null | Promise<BodyInit | null>;
}

/** Structural subset implemented by `x402Client` from `@x402/fetch`. */
export interface OfficialX402ClientLike<
  TRequired = unknown,
  TPayload = unknown,
> {
  createPaymentPayload(paymentRequired: TRequired): Promise<TPayload>;
}

/** Structural subset implemented by `x402HTTPClient` from `@x402/fetch`. */
export interface OfficialX402HttpClientLike<
  TRequired = unknown,
  TPayload = unknown,
> {
  getPaymentRequiredResponse(
    getHeader: (name: string) => string | null,
    body?: TRequired,
  ): TRequired;
  encodePaymentSignatureHeader(payload: TPayload): Record<string, string>;
  processPaymentResult?(
    payload: TPayload,
    getHeader: (name: string) => string | null,
    status: number,
  ): Promise<unknown>;
}

/** Adapt the current official x402 client objects to x424's ordered flow. */
export function createOfficialX402PaymentResolver<TRequired, TPayload>(input: {
  readonly client: OfficialX402ClientLike<TRequired, TPayload>;
  readonly httpClient: OfficialX402HttpClientLike<TRequired, TPayload>;
}): PaymentDependencyResolver {
  return async ({ response }) => {
    let body: TRequired | undefined;
    try {
      const text = await response.clone().text();
      if (text) body = JSON.parse(text) as TRequired;
    } catch {
      body = undefined;
    }
    const required = input.httpClient.getPaymentRequiredResponse(
      (name) => response.headers.get(name),
      body,
    );
    const payload = await input.client.createPaymentPayload(required);
    const headers = input.httpClient.encodePaymentSignatureHeader(payload);
    const paymentSignature = Object.entries(headers).find(
      ([name]) => name.toLowerCase() === PAYMENT_SIGNATURE_HEADER,
    )?.[1];
    if (!paymentSignature) {
      throw new Error("Official x402 client omitted PAYMENT-SIGNATURE");
    }
    return {
      paymentSignature,
      ...(input.httpClient.processPaymentResult
        ? {
            processResponse: async (paymentResponse: Response) => {
              await input.httpClient.processPaymentResult!(
                payload,
                (name) => paymentResponse.headers.get(name),
                paymentResponse.status,
              );
            },
          }
        : {}),
    };
  };
}

function assertNoRedirect(request: Request, response: Response): void {
  if (
    response.type === "opaqueredirect" ||
    REDIRECT_STATUSES.has(response.status) ||
    isCrossOriginRedirect(request.url, response.headers.get("location"))
  ) {
    throw new Error("x424/x402 refuses redirects during dependency resolution");
  }
}

async function requirementFromResponse(
  request: Request,
  response: Response,
): Promise<HumanRequirement | undefined> {
  const header = response.headers.get(HUMAN_REQUIRED_HEADER);
  const contentType = response.headers.get("content-type") ?? "";
  let body: unknown = null;
  if (
    contentType.includes("application/problem+json") ||
    contentType.includes("application/json")
  ) {
    try {
      body = await response.clone().json();
    } catch {
      if (!header) return undefined;
    }
  } else if (!header) {
    return undefined;
  }
  let requirement: HumanRequirement;
  try {
    requirement = requirementFromChallenge({ headers: response.headers, body });
  } catch {
    return undefined;
  }
  assertChallengeRequestMatch({
    requestMethod: request.method,
    requestUrl: request.url,
    challengeUrl: response.url || request.url,
    resourceMethod: requirement.resource.method,
    resourceUri: requirement.resource.uri,
  });
  return requirement;
}

async function requestCopies(
  input: string | URL | Request,
  init: RequestInit | undefined,
  bodyFactory: X424X402FetchOptions["bodyFactory"],
): Promise<readonly [Request, Request, Request]> {
  const seed = new Request(input, init);
  if (!bodyFactory) {
    try {
      return [seed.clone(), seed.clone(), seed.clone()];
    } catch {
      throw new Error(
        "Request body is not replayable across x424/x402; supply bodyFactory",
      );
    }
  }
  const build = async (attempt: 1 | 2 | 3): Promise<Request> => {
    const body = await bodyFactory(attempt);
    return new Request(seed.url, {
      method: seed.method,
      headers: seed.headers,
      body,
      credentials: seed.credentials,
      cache: seed.cache,
      integrity: seed.integrity,
      keepalive: seed.keepalive,
      mode: seed.mode,
      redirect: "manual",
      referrer: seed.referrer,
      referrerPolicy: seed.referrerPolicy,
      signal: seed.signal,
    });
  };
  return [await build(1), await build(2), await build(3)];
}

/**
 * Resolve 424 first, then 402, then send both independent proof headers.
 * A correctly composed server never evaluates payment before humanity.
 */
export async function fetchWithX424AndX402(
  input: string | URL | Request,
  init: RequestInit | undefined,
  options: X424X402FetchOptions,
): Promise<Response> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const [first, second, third] = await requestCopies(
    input,
    init,
    options.bodyFactory,
  );
  let currentRequest = first;
  let response = await fetchImplementation(
    new Request(currentRequest, { redirect: "manual" }),
  );
  assertNoRedirect(currentRequest, response);

  let humanProof: string | undefined;
  if (response.status === 424) {
    if (currentRequest.headers.has(HUMAN_PROOF_HEADER)) return response;
    const requirement = await requirementFromResponse(currentRequest, response);
    if (!requirement) return response;
    const resolution = await options.resolveHumanDependency({
      requirement,
      response,
    });
    if (!resolution.humanProof || resolution.humanProof.length > 65_536) {
      throw new Error("Human dependency resolver returned an invalid proof");
    }
    humanProof = resolution.humanProof;
    const headers = new Headers(second.headers);
    headers.set(HUMAN_PROOF_HEADER, humanProof);
    currentRequest = new Request(second, { headers, redirect: "manual" });
    response = await fetchImplementation(currentRequest);
    assertNoRedirect(currentRequest, response);
  }

  if (response.status !== 402) return response;
  if (!humanProof && !currentRequest.headers.has(HUMAN_PROOF_HEADER)) {
    throw new Error("Server evaluated x402 before the x424 dependency");
  }
  const payment = await options.resolvePaymentDependency({
    response,
    request: currentRequest,
  });
  if (!payment.paymentSignature || payment.paymentSignature.length > 65_536) {
    throw new Error(
      "Payment dependency resolver returned an invalid signature",
    );
  }
  const finalHeaders = new Headers(third.headers);
  finalHeaders.set(
    HUMAN_PROOF_HEADER,
    humanProof ?? currentRequest.headers.get(HUMAN_PROOF_HEADER)!,
  );
  finalHeaders.set(PAYMENT_SIGNATURE_HEADER, payment.paymentSignature);
  const finalRequest = new Request(third, {
    headers: finalHeaders,
    redirect: "manual",
  });
  const finalResponse = await fetchImplementation(finalRequest);
  assertNoRedirect(finalRequest, finalResponse);
  await payment.processResponse?.(finalResponse);
  return finalResponse;
}

/** Express middleware tuple with humanity unconditionally first. */
export function composeX424BeforeX402(
  humanity: RequestHandler,
  payment: RequestHandler,
): readonly [RequestHandler, RequestHandler] {
  return Object.freeze([humanity, payment]);
}

export type FetchDependencyGate = (
  request: Request,
) => Promise<Response | undefined> | Response | undefined;

/** Fetch/Next gate composition; payment is unreachable until humanity passes. */
export function composeFetchX424BeforeX402(
  humanity: FetchDependencyGate,
  payment: FetchDependencyGate,
): FetchDependencyGate {
  return async (request) => {
    const humanResponse = await humanity(request);
    if (humanResponse) return humanResponse;
    return payment(request);
  };
}

/** Next.js uses the Fetch contract; this name makes the supported surface explicit. */
export const composeNextX424BeforeX402 = composeFetchX424BeforeX402;
