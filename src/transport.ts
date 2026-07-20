/**
 * HTTP transport profile for x424/0.1 (ADR-0001).
 * Fail closed on oversized headers, disallowed CORS, and unsafe redirects.
 */

export const X424_TRANSPORT_PROFILE = "x424-transport-0.1" as const;

/** Absolute decode/encode rejection threshold (existing implementation max). */
export const X424_HEADER_ABSOLUTE_MAX_BYTES = 65_536;

/**
 * Conservative interoperability envelope for inline HUMAN-REQUIRED.
 * Issuers SHOULD switch to body/reference transport above this size.
 */
export const X424_HEADER_INTEROP_ENVELOPE_BYTES = 8_192;

export type X424RequirementTransportMode = "header" | "body" | "reference";

export const X424_EXPOSED_HEADERS = [
  "HUMAN-REQUIRED",
  "HUMAN-PROOF",
  "HUMAN-RESULT",
] as const;

export const X424_ALLOW_HEADERS = [
  "HUMAN-PROOF",
  "Content-Type",
  "Authorization",
  "Idempotency-Key",
  "Content-Digest",
] as const;

export interface X424CorsPolicy {
  readonly allowedOrigins: readonly string[];
  readonly allowCredentials?: boolean;
  readonly maxAgeSeconds?: number;
}

export function selectRequirementTransportMode(
  encodedHeaderLength: number,
): X424RequirementTransportMode {
  if (encodedHeaderLength > X424_HEADER_ABSOLUTE_MAX_BYTES) {
    throw new Error("x424 requirement exceeds absolute header maximum");
  }
  if (encodedHeaderLength > X424_HEADER_INTEROP_ENVELOPE_BYTES) {
    return "body";
  }
  return "header";
}

export function assertHeaderSize(value: string, label = "x424 header"): void {
  if (!value || value.length > X424_HEADER_ABSOLUTE_MAX_BYTES) {
    throw new Error(`Invalid ${label}`);
  }
}

export function buildCorsHeaders(
  requestOrigin: string | null | undefined,
  policy: X424CorsPolicy,
): Record<string, string> | null {
  if (!requestOrigin) return null;
  if (!policy.allowedOrigins.includes(requestOrigin)) return null;
  const headers: Record<string, string> = {
    "access-control-allow-origin": requestOrigin,
    "access-control-expose-headers": X424_EXPOSED_HEADERS.join(", "),
    "access-control-allow-headers": X424_ALLOW_HEADERS.join(", "),
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    vary: "Origin",
  };
  if (policy.allowCredentials) {
    headers["access-control-allow-credentials"] = "true";
  }
  if (policy.maxAgeSeconds !== undefined) {
    headers["access-control-max-age"] = String(policy.maxAgeSeconds);
  }
  return headers;
}

/** Challenge URI must match the request and requirement resource URI. */
export function assertChallengeRequestMatch(input: {
  readonly requestMethod: string;
  readonly requestUrl: string;
  readonly challengeUrl: string;
  readonly resourceMethod: string;
  readonly resourceUri: string;
}): void {
  let request: URL;
  let challenge: URL;
  let resource: URL;
  try {
    request = new URL(input.requestUrl);
    challenge = new URL(input.challengeUrl);
    resource = new URL(input.resourceUri);
  } catch {
    throw new Error("x424 challenge URL is not absolute");
  }
  if (
    request.origin !== challenge.origin ||
    request.origin !== resource.origin
  ) {
    throw new Error("x424 challenge crossed an origin boundary");
  }
  if (
    input.resourceMethod !== input.requestMethod ||
    resource.href !== challenge.href
  ) {
    throw new Error("Human dependency challenge names another HTTP request");
  }
}

export function isCrossOriginRedirect(
  fromUrl: string,
  toUrl: string | null,
): boolean {
  if (!toUrl) return false;
  try {
    return new URL(fromUrl).origin !== new URL(toUrl).origin;
  } catch {
    return true;
  }
}
