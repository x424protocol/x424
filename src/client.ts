import {
  HUMAN_PROOF_HEADER,
  HUMAN_REQUIRED_HEADER,
  HUMAN_RESULT_HEADER,
  decodeHumanRequirement,
} from "./http.js";
import { methodKey } from "./catalog.js";
import { X424_VERSION, type HumanRequirement } from "./types.js";

export interface HumanDependencyResolution {
  /** Signed x424-result+jws token returned by a trusted verifier. */
  readonly humanProof: string;
}

export type HumanDependencyResolver = (input: {
  readonly requirement: HumanRequirement;
  readonly response: Response;
}) => Promise<HumanDependencyResolution>;

export interface X424FetchOptions {
  readonly resolveHumanDependency: HumanDependencyResolver;
  readonly fetchImplementation?: typeof fetch;
}

export interface ProviderProofResolution {
  readonly providerId: string;
  readonly methodId: string;
  readonly descriptorVersion: string;
  readonly nativeProof: unknown;
}

export type ProviderProofResolver = (input: {
  readonly requirement: HumanRequirement;
}) => Promise<ProviderProofResolution>;

export interface HttpHumanDependencyResolverOptions {
  /** Base URL of the trusted x424 verifier. */
  readonly verifierUrl: string | URL;
  /** Runs the selected provider UI or wallet ceremony. */
  readonly resolveProviderProof: ProviderProofResolver;
  readonly fetchImplementation?: typeof fetch;
  readonly headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
}

/**
 * Compose a provider ceremony with the standard verifier submission. Adopters
 * supply provider UI and credentials; this helper owns x424 submission,
 * method checks, and extraction of the signed result token.
 */
export function createHttpHumanDependencyResolver(
  options: HttpHumanDependencyResolverOptions,
): HumanDependencyResolver {
  return async ({ requirement }) => {
    const resolved = await options.resolveProviderProof({ requirement });
    const accepted = requirement.accepts.some(
      (method) =>
        methodKey(method.providerId, method.methodId) ===
          methodKey(resolved.providerId, resolved.methodId) &&
        method.descriptorVersion === resolved.descriptorVersion,
    );
    if (!accepted) {
      throw new Error("Provider resolver selected an unaccepted human method");
    }

    const base = new URL(options.verifierUrl);
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    const endpoint = new URL(
      `v1/requirements/${encodeURIComponent(requirement.dependencyId)}/verify`,
      base,
    );
    const configuredHeaders =
      typeof options.headers === "function"
        ? await options.headers()
        : options.headers;
    const headers = new Headers(configuredHeaders);
    headers.set("content-type", "application/json");
    const response = await (options.fetchImplementation ?? fetch)(
      new Request(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          x424Version: X424_VERSION,
          dependencyId: requirement.dependencyId,
          providerId: resolved.providerId,
          methodId: resolved.methodId,
          binding: requirement.binding,
          nativeProof: resolved.nativeProof,
        }),
      }),
    );
    if (!response.ok) {
      throw new Error(`x424 verifier rejected the proof (${response.status})`);
    }
    const humanProof = response.headers.get(HUMAN_RESULT_HEADER);
    if (!humanProof) {
      throw new Error("x424 verifier omitted HUMAN-RESULT");
    }
    return { humanProof };
  };
}

/**
 * Execute one HTTP request, resolve one x424 challenge, and retry once with
 * HUMAN-PROOF. The resolver owns provider UI/handoff and verifier submission.
 * Payment and application authorization remain separate response stages.
 */
export async function fetchWithX424(
  input: string | URL | Request,
  init: RequestInit | undefined,
  options: X424FetchOptions,
): Promise<Response> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const firstRequest = new Request(input, init);
  const retryBody = firstRequest.clone();
  const firstResponse = await fetchImplementation(firstRequest);
  const required = firstResponse.headers.get(HUMAN_REQUIRED_HEADER);

  if (firstResponse.status !== 424 || !required) return firstResponse;
  if (firstRequest.headers.has(HUMAN_PROOF_HEADER)) return firstResponse;

  const requirement = decodeHumanRequirement(required);
  const challengedUri = firstResponse.url || firstRequest.url;
  if (
    requirement.resource.method !== firstRequest.method ||
    requirement.resource.uri !== challengedUri
  ) {
    throw new Error("Human dependency challenge names another HTTP request");
  }
  const resolution = await options.resolveHumanDependency({
    requirement,
    response: firstResponse,
  });
  if (!resolution.humanProof || resolution.humanProof.length > 65_536) {
    throw new Error("Human dependency resolver returned an invalid proof");
  }

  const headers = new Headers(retryBody.headers);
  headers.set(HUMAN_PROOF_HEADER, resolution.humanProof);
  return fetchImplementation(new Request(retryBody, { headers }));
}
