/**
 * HTTP transport profile for x424/0.1 (ADR-0001).
 * Supported modes: header (≤8 KiB encoded) and body. Reference is not supported.
 */

export const X424_TRANSPORT_PROFILE = "x424-transport-0.1" as const;

/** Absolute encoded header rejection threshold (UTF-16 code unit ≈ ASCII byte for base64url). */
export const X424_HEADER_ABSOLUTE_MAX_BYTES = 65_536;

/**
 * Conservative interoperability envelope for inline HUMAN-REQUIRED.
 * Measured as the encoded header string length (base64url characters).
 */
export const X424_HEADER_INTEROP_ENVELOPE_BYTES = 8_192;

/** Supported requirement transport modes in x424/0.1. */
export type X424RequirementTransportMode = "header" | "body";

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

/**
 * Explicit public origin for absolute URI construction. Never trust
 * X-Forwarded-* unless the caller opts into a reviewed proxy profile.
 */
export interface PublicOriginConfig {
  /** Exact origin, e.g. https://api.example.test — used for challenge URIs. */
  readonly publicOrigin: string;
  /**
   * When true, Host may be taken from X-Forwarded-Host only if it matches
   * publicOrigin's host. Proto must still match publicOrigin.
   */
  readonly allowMatchingForwardedHost?: boolean;
}

export function encodedHeaderByteLength(encoded: string): number {
  // base64url is ASCII; string length equals UTF-8 byte length.
  return Buffer.byteLength(encoded, "utf8");
}

export function selectRequirementTransportMode(
  encodedHeaderLength: number,
): X424RequirementTransportMode {
  if (encodedHeaderLength > X424_HEADER_ABSOLUTE_MAX_BYTES) {
    throw new Error("x424 requirement exceeds absolute transport maximum");
  }
  if (encodedHeaderLength > X424_HEADER_INTEROP_ENVELOPE_BYTES) {
    return "body";
  }
  return "header";
}

export function assertHeaderSize(value: string, label = "x424 header"): void {
  if (!value) throw new Error(`Invalid ${label}`);
  if (encodedHeaderByteLength(value) > X424_HEADER_ABSOLUTE_MAX_BYTES) {
    throw new Error(`Invalid ${label}`);
  }
}

export function assertInlineHeaderEnvelope(encoded: string): void {
  const length = encodedHeaderByteLength(encoded);
  if (length > X424_HEADER_INTEROP_ENVELOPE_BYTES) {
    throw new Error(
      "HUMAN-REQUIRED exceeds interop envelope; use body transport",
    );
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

export function resolvePublicAbsoluteUri(input: {
  readonly config: PublicOriginConfig;
  readonly pathWithQuery: string;
  readonly forwardedHost?: string | null;
  readonly forwardedProto?: string | null;
}): string {
  let origin: URL;
  try {
    origin = new URL(input.config.publicOrigin);
  } catch {
    throw new Error("publicOrigin must be an absolute URL origin");
  }
  if (origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("publicOrigin must not include path, query, or hash");
  }
  if (
    input.config.allowMatchingForwardedHost &&
    input.forwardedHost &&
    input.forwardedHost !== origin.host
  ) {
    throw new Error("Forwarded host does not match configured publicOrigin");
  }
  if (
    input.config.allowMatchingForwardedHost &&
    input.forwardedProto &&
    input.forwardedProto !== origin.protocol.replace(":", "")
  ) {
    throw new Error("Forwarded proto does not match configured publicOrigin");
  }
  if (
    !input.pathWithQuery.startsWith("/") ||
    input.pathWithQuery.startsWith("//") ||
    input.pathWithQuery.includes("\\") ||
    input.pathWithQuery.includes("#")
  ) {
    throw new Error("Request path must be an unambiguous origin-relative path");
  }
  const resolved = new URL(input.pathWithQuery, origin);
  if (resolved.origin !== origin.origin) {
    throw new Error("Request path escaped configured publicOrigin");
  }
  return resolved.href;
}

/** Merge Vary values without losing an earlier CORS or proof variation. */
export function mergeVary(
  existing: string | string[] | number | undefined,
  ...values: readonly string[]
): string {
  const current = Array.isArray(existing)
    ? existing.join(",")
    : existing === undefined
      ? ""
      : String(existing);
  const tokens = current
    .split(",")
    .concat(values)
    .map((value) => value.trim())
    .filter(Boolean);
  if (tokens.some((value) => value === "*")) return "*";
  const seen = new Set<string>();
  return tokens
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(", ");
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
    input.resourceMethod !== input.requestMethod.toUpperCase() ||
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

export function assertTrustedHttpsUrl(
  url: string | URL,
  allowHttpLocalhost: boolean,
): URL {
  const parsed = typeof url === "string" ? new URL(url) : url;
  if (parsed.protocol === "https:") return parsed;
  if (
    allowHttpLocalhost &&
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
  ) {
    return parsed;
  }
  throw new Error("Verifier URL must use https outside local development");
}
