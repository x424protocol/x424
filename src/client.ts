import {
  HUMAN_PROOF_HEADER,
  HUMAN_REQUIRED_HEADER,
  HUMAN_RESULT_HEADER,
  requirementFromChallenge,
} from "./http.js";
import { methodKey } from "./catalog.js";
import {
  assertChallengeRequestMatch,
  assertTrustedHttpsUrl,
  isCrossOriginRedirect,
} from "./transport.js";
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
  /**
   * Allow http://localhost and http://127.0.0.1 for local development only.
   * Default false — HTTPS required.
   */
  readonly allowHttpLocalhost?: boolean;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Compose a provider ceremony with the standard verifier submission.
 * Never follows redirects with nativeProof.
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

    const base = assertTrustedHttpsUrl(
      options.verifierUrl,
      options.allowHttpLocalhost === true,
    );
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    const endpoint = new URL(
      `v1/requirements/${encodeURIComponent(requirement.dependencyId)}/verify`,
      base,
    );
    const pinnedOrigin = endpoint.origin;

    const configuredHeaders =
      typeof options.headers === "function"
        ? await options.headers()
        : options.headers;
    const headers = new Headers(configuredHeaders);
    headers.set("content-type", "application/json");
    // Never send credentials cross-origin; pin to configured verifier only.
    const body = JSON.stringify({
      x424Version: X424_VERSION,
      dependencyId: requirement.dependencyId,
      providerId: resolved.providerId,
      methodId: resolved.methodId,
      binding: requirement.binding,
      nativeProof: resolved.nativeProof,
    });

    const response = await (options.fetchImplementation ?? fetch)(
      new Request(endpoint, {
        method: "POST",
        headers,
        body,
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
      }),
    );

    if (response.type === "opaqueredirect") {
      throw new Error(
        "x424 refuses opaque redirects during verifier submission",
      );
    }
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      // Never resend nativeProof — including same-origin redirects.
      if (isCrossOriginRedirect(endpoint.href, location)) {
        throw new Error(
          "x424 refuses cross-origin redirect during verifier submission",
        );
      }
      throw new Error(
        "x424 refuses redirects during verifier proof submission",
      );
    }

    if (new URL(response.url || endpoint.href).origin !== pinnedOrigin) {
      throw new Error(
        "Verifier response origin does not match configured verifier",
      );
    }
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
 * HUMAN-PROOF.
 */
export async function fetchWithX424(
  input: string | URL | Request,
  init: RequestInit | undefined,
  options: X424FetchOptions,
): Promise<Response> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const firstRequest = new Request(input, init);
  let retryBody: Request;
  try {
    retryBody = firstRequest.clone();
  } catch {
    throw new Error(
      "Request body is not replayable; supply a cloneable body or precomputed digest",
    );
  }
  const firstResponse = await fetchImplementation(
    new Request(firstRequest, {
      redirect: "manual",
      credentials: firstRequest.credentials,
    }),
  );
  if (
    isCrossOriginRedirect(
      firstRequest.url,
      firstResponse.headers.get("location"),
    )
  ) {
    throw new Error("x424 refuses cross-origin redirect during challenge");
  }
  if (firstResponse.type === "opaqueredirect") {
    throw new Error("x424 refuses opaque redirects during challenge");
  }
  if (REDIRECT_STATUSES.has(firstResponse.status)) {
    throw new Error("x424 refuses redirects during challenge detection");
  }

  if (firstResponse.status !== 424) return firstResponse;
  if (firstRequest.headers.has(HUMAN_PROOF_HEADER)) return firstResponse;

  const headerRequired = firstResponse.headers.get(HUMAN_REQUIRED_HEADER);
  const contentType = firstResponse.headers.get("content-type") ?? "";
  let body: unknown = null;
  if (
    contentType.includes("application/problem+json") ||
    contentType.includes("application/json")
  ) {
    try {
      body = await firstResponse.clone().json();
    } catch {
      // A header-only challenge may have an unrelated or empty body.  A body
      // challenge, however, is not actionable without valid JSON.
      if (!headerRequired) return firstResponse;
    }
  } else if (!headerRequired) {
    return firstResponse;
  }
  let requirement: HumanRequirement;
  try {
    requirement = requirementFromChallenge({
      headers: firstResponse.headers,
      body,
    });
  } catch {
    // Do not pass a malformed or ambiguous 424 to a resolver.
    return firstResponse;
  }

  const challengedUri = firstResponse.url || firstRequest.url;
  assertChallengeRequestMatch({
    requestMethod: firstRequest.method,
    requestUrl: firstRequest.url,
    challengeUrl: challengedUri,
    resourceMethod: requirement.resource.method,
    resourceUri: requirement.resource.uri,
  });
  const resolution = await options.resolveHumanDependency({
    requirement,
    response: firstResponse,
  });
  if (!resolution.humanProof || resolution.humanProof.length > 65_536) {
    throw new Error("Human dependency resolver returned an invalid proof");
  }

  const headers = new Headers(retryBody.headers);
  headers.set(HUMAN_PROOF_HEADER, resolution.humanProof);
  return fetchImplementation(
    new Request(retryBody, { headers, redirect: "manual" }),
  );
}
