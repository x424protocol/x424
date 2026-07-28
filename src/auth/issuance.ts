/**
 * Authenticated requirement issuance (P2-02).
 * Missing grants deny. Authentication alone never grants arbitrary issuance.
 */

import { createHash } from "node:crypto";

export type DeploymentProfile =
  "dev-local-0.1" | "eval-redis-0.2" | "prod-ha-0.2";

export interface ResourceUriGrant {
  /** Exact origin, e.g. https://api.example.test */
  readonly origin: string;
  /**
   * Exact path prefix after normalization. Trailing slash means directory
   * boundary: `/records` matches `/records` and `/records/...` but not
   * `/records-evil`.
   */
  readonly pathPrefix: string;
}

/**
 * Least-privilege issuer principal. Empty grant arrays deny all issuances.
 * There is no implicit wildcard.
 */
export interface IssuancePrincipal {
  readonly subject: string;
  readonly issuer?: string;
  readonly allowedPurposes: readonly string[];
  readonly allowedAudiences: readonly string[];
  readonly allowedHttpMethods: readonly string[];
  /** Exact `providerId:methodId` tuples. */
  readonly allowedMethods: readonly string[];
  readonly allowedResources: readonly ResourceUriGrant[];
}

/** Explicit development-only unrestricted principal. Forbidden in eval/prod. */
export interface DevWildcardIssuancePrincipal {
  readonly subject: string;
  readonly __devWildcardIssuance: true;
}

export type AnyIssuancePrincipal =
  IssuancePrincipal | DevWildcardIssuancePrincipal;

export interface IssuanceAuthorizationRequest {
  readonly purpose: string;
  readonly method: string;
  readonly uri: string;
  readonly audience: string;
  readonly accepts: readonly {
    readonly providerId: string;
    readonly methodId: string;
  }[];
}

export interface IssuanceAuthenticator {
  authenticate(input: {
    readonly authorizationHeader?: string | null;
    readonly clientCertificateFingerprint?: string | null;
  }): Promise<AnyIssuancePrincipal>;
}

export class IssuanceAuthorizationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "IssuanceAuthorizationError";
    this.code = code;
  }
}

function isDevWildcard(
  principal: AnyIssuancePrincipal,
): principal is DevWildcardIssuancePrincipal {
  return (
    Object.prototype.hasOwnProperty.call(principal, "__devWildcardIssuance") &&
    (principal as Partial<DevWildcardIssuancePrincipal>)
      .__devWildcardIssuance === true
  );
}

const MAXIMUM_BEARER_TOKEN_LENGTH = 4_096;
const MAXIMUM_PRINCIPAL_STRING_LENGTH = 2_048;
const BEARER_TOKEN_PATTERN = /^[A-Za-z0-9\-._~+/]{1,4096}={0,2}$/u;
const PRINCIPAL_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

function bearerCredentialDigest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function exactOwnKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function validatedPrincipalString(
  value: unknown,
  maximumLength = MAXIMUM_PRINCIPAL_STRING_LENGTH,
): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    PRINCIPAL_CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return undefined;
  }
  return value;
}

function validatedPrincipalStringArray(
  value: unknown,
): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings: string[] = [];
  for (const entry of value) {
    const string = validatedPrincipalString(entry);
    if (string === undefined) return undefined;
    strings.push(string);
  }
  return Object.freeze(strings);
}

/**
 * Validate and snapshot an authenticator result before it crosses a trust
 * boundary. The returned principal contains own data properties only and
 * cannot be changed by mutating the authenticator's source configuration.
 */
export function validateIssuancePrincipal(
  input: unknown,
): AnyIssuancePrincipal {
  const invalid = () =>
    new IssuanceAuthorizationError(
      "UNAUTHENTICATED",
      "Authenticated issuer principal is invalid",
    );
  if (!isPlainRecord(input)) throw invalid();
  const subject = validatedPrincipalString(
    hasOwn(input, "subject") ? input.subject : undefined,
    512,
  );
  if (subject === undefined) throw invalid();

  if (
    hasOwn(input, "__devWildcardIssuance") &&
    input.__devWildcardIssuance === true
  ) {
    if (!exactOwnKeys(input, ["subject", "__devWildcardIssuance"])) {
      throw invalid();
    }
    return Object.freeze({
      subject,
      __devWildcardIssuance: true,
    });
  }

  const allowedKeys = [
    "subject",
    "issuer",
    "allowedPurposes",
    "allowedAudiences",
    "allowedHttpMethods",
    "allowedMethods",
    "allowedResources",
  ] as const;
  if (!exactOwnKeys(input, allowedKeys)) throw invalid();
  for (const required of [
    "allowedPurposes",
    "allowedAudiences",
    "allowedHttpMethods",
    "allowedMethods",
    "allowedResources",
  ] as const) {
    if (!hasOwn(input, required)) throw invalid();
  }

  const issuer = hasOwn(input, "issuer")
    ? validatedPrincipalString(input.issuer)
    : undefined;
  if (hasOwn(input, "issuer") && issuer === undefined) throw invalid();
  const allowedPurposes = validatedPrincipalStringArray(input.allowedPurposes);
  const allowedAudiences = validatedPrincipalStringArray(
    input.allowedAudiences,
  );
  const allowedHttpMethods = validatedPrincipalStringArray(
    input.allowedHttpMethods,
  );
  const allowedMethods = validatedPrincipalStringArray(input.allowedMethods);
  if (
    !allowedPurposes ||
    !allowedAudiences ||
    !allowedHttpMethods ||
    !allowedMethods ||
    !Array.isArray(input.allowedResources)
  ) {
    throw invalid();
  }
  const allowedResources: ResourceUriGrant[] = [];
  for (const entry of input.allowedResources) {
    if (
      !isPlainRecord(entry) ||
      !exactOwnKeys(entry, ["origin", "pathPrefix"]) ||
      !hasOwn(entry, "origin") ||
      !hasOwn(entry, "pathPrefix")
    ) {
      throw invalid();
    }
    const origin = validatedPrincipalString(entry.origin);
    const pathPrefix = validatedPrincipalString(entry.pathPrefix);
    if (origin === undefined || pathPrefix === undefined) throw invalid();
    allowedResources.push(Object.freeze({ origin, pathPrefix }));
  }

  return Object.freeze({
    subject,
    ...(issuer === undefined ? {} : { issuer }),
    allowedPurposes,
    allowedAudiences,
    allowedHttpMethods,
    allowedMethods,
    allowedResources: Object.freeze(allowedResources),
  });
}

export function normalizeHttpMethod(method: string): string {
  return method.toUpperCase();
}

/** Fail closed on encoded traversal and other ambiguous path forms. */
export function normalizeAuthorizedPath(pathname: string): string | null {
  if (!pathname.startsWith("/")) return null;
  // Reject remaining percent-encoding and backslashes after URL parsing.
  if (
    pathname.includes("%") ||
    pathname.includes("\\") ||
    pathname.includes("\0")
  ) {
    return null;
  }
  if (pathname.includes("//")) return null;
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  for (const segment of segments) {
    if (segment === "." || segment === "..") return null;
  }
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

export function resourceUriAuthorized(
  uri: string,
  grants: readonly ResourceUriGrant[],
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  // Reject credentials and unexpected components.
  if (parsed.username || parsed.password || parsed.protocol !== "https:")
    return false;
  const path = normalizeAuthorizedPath(parsed.pathname);
  if (path === null) return false;

  for (const grant of grants) {
    let grantOrigin: URL;
    try {
      grantOrigin = new URL(grant.origin);
    } catch {
      continue;
    }
    if (
      grantOrigin.protocol !== "https:" ||
      grantOrigin.pathname !== "/" ||
      grantOrigin.search ||
      grantOrigin.hash ||
      grantOrigin.username ||
      grantOrigin.password
    ) {
      continue;
    }
    if (parsed.origin !== grantOrigin.origin) continue;
    const rawPrefix = grant.pathPrefix || "/";
    if (rawPrefix.includes("%") || rawPrefix.includes("\\")) continue;
    const prefix = normalizeAuthorizedPath(rawPrefix);
    if (prefix === null) continue;
    if (prefix === "/") return true;
    if (path === prefix) return true;
    const boundary = prefix.endsWith("/") ? prefix : `${prefix}/`;
    if (path.startsWith(boundary)) return true;
  }
  return false;
}

export function authorizeIssuance(
  principal: AnyIssuancePrincipal,
  request: IssuanceAuthorizationRequest,
  profile: DeploymentProfile,
): void {
  principal = validateIssuancePrincipal(principal);
  if (profile !== "dev-local-0.1") {
    let resource: URL;
    let audience: URL;
    try {
      resource = new URL(request.uri);
      audience = new URL(request.audience);
    } catch {
      throw new IssuanceAuthorizationError(
        "RESOURCE_NOT_AUTHORIZED",
        "Resource and audience must be valid HTTPS URLs",
      );
    }
    if (resource.protocol !== "https:" || audience.protocol !== "https:") {
      throw new IssuanceAuthorizationError(
        "RESOURCE_NOT_AUTHORIZED",
        "Resource and audience must use HTTPS outside dev-local-0.1",
      );
    }
  }
  if (isDevWildcard(principal)) {
    if (profile !== "dev-local-0.1") {
      throw new IssuanceAuthorizationError(
        "METHOD_NOT_AUTHORIZED",
        "Development wildcard issuance is forbidden outside dev-local-0.1",
      );
    }
    return;
  }

  // Incomplete principals (missing grant arrays) deny closed.
  const purposes = Array.isArray(principal.allowedPurposes)
    ? principal.allowedPurposes
    : [];
  const audiences = Array.isArray(principal.allowedAudiences)
    ? principal.allowedAudiences
    : [];
  const httpMethods = Array.isArray(principal.allowedHttpMethods)
    ? principal.allowedHttpMethods
    : [];
  const resources = Array.isArray(principal.allowedResources)
    ? principal.allowedResources
    : [];
  const methods = Array.isArray(principal.allowedMethods)
    ? principal.allowedMethods
    : [];

  if (purposes.length === 0) {
    throw new IssuanceAuthorizationError(
      "PURPOSE_NOT_AUTHORIZED",
      "Issuer has no allowed purposes",
    );
  }
  if (!purposes.includes(request.purpose)) {
    throw new IssuanceAuthorizationError(
      "PURPOSE_NOT_AUTHORIZED",
      "Issuer is not authorized for this purpose",
    );
  }

  if (audiences.length === 0) {
    throw new IssuanceAuthorizationError(
      "AUDIENCE_NOT_AUTHORIZED",
      "Issuer has no allowed audiences",
    );
  }
  if (!audiences.includes(request.audience)) {
    throw new IssuanceAuthorizationError(
      "AUDIENCE_NOT_AUTHORIZED",
      "Issuer is not authorized for this audience",
    );
  }

  const httpMethod = normalizeHttpMethod(request.method);
  if (httpMethods.length === 0) {
    throw new IssuanceAuthorizationError(
      "HTTP_METHOD_NOT_AUTHORIZED",
      "Issuer has no allowed HTTP methods",
    );
  }
  if (!httpMethods.includes(httpMethod)) {
    throw new IssuanceAuthorizationError(
      "HTTP_METHOD_NOT_AUTHORIZED",
      "Issuer is not authorized for this HTTP method",
    );
  }

  if (resources.length === 0) {
    throw new IssuanceAuthorizationError(
      "RESOURCE_NOT_AUTHORIZED",
      "Issuer has no allowed resources",
    );
  }
  if (!resourceUriAuthorized(request.uri, resources)) {
    throw new IssuanceAuthorizationError(
      "RESOURCE_NOT_AUTHORIZED",
      "Issuer is not authorized for this resource URI",
    );
  }

  if (methods.length === 0) {
    throw new IssuanceAuthorizationError(
      "METHOD_NOT_AUTHORIZED",
      "Issuer has no allowed human methods",
    );
  }
  for (const method of request.accepts) {
    const key = `${method.providerId}:${method.methodId}`;
    if (!methods.includes(key)) {
      throw new IssuanceAuthorizationError(
        "METHOD_NOT_AUTHORIZED",
        "Issuer is not authorized for an accepted method",
      );
    }
  }
}

export function assertIssuanceRouterConfig(input: {
  readonly deploymentProfile?: DeploymentProfile;
  readonly allowUnauthenticatedIssuance?: boolean;
  readonly issuanceAuthenticator?: IssuanceAuthenticator;
}): DeploymentProfile {
  if (!input.deploymentProfile) {
    throw new Error(
      "deploymentProfile is required; omission does not select dev-local",
    );
  }
  const profile = input.deploymentProfile;
  if (profile === "dev-local-0.1") {
    if (!input.issuanceAuthenticator && !input.allowUnauthenticatedIssuance) {
      throw new Error(
        "dev-local-0.1 requires issuanceAuthenticator or explicit allowUnauthenticatedIssuance: true",
      );
    }
    return profile;
  }
  if (!input.issuanceAuthenticator) {
    throw new Error(
      "eval/prod deployment profiles require issuanceAuthenticator",
    );
  }
  if (input.allowUnauthenticatedIssuance) {
    throw new Error(
      "allowUnauthenticatedIssuance is forbidden outside dev-local-0.1",
    );
  }
  return profile;
}

/** Bearer token authenticator for evaluation profiles. Not a full OAuth AS. */
export function createStaticBearerIssuanceAuthenticator(
  tokens: Readonly<Record<string, AnyIssuancePrincipal>>,
): IssuanceAuthenticator {
  if (!isPlainRecord(tokens)) {
    throw new Error("Static bearer credentials must be a plain record");
  }
  const credentialsByDigest = new Map<string, AnyIssuancePrincipal>();
  for (const [token, configuredPrincipal] of Object.entries(tokens)) {
    if (
      token.length > MAXIMUM_BEARER_TOKEN_LENGTH ||
      !BEARER_TOKEN_PATTERN.test(token)
    ) {
      throw new Error("Static bearer credential contains an invalid token");
    }
    const digest = bearerCredentialDigest(token);
    if (credentialsByDigest.has(digest)) {
      throw new Error("Static bearer credentials must be unique");
    }
    credentialsByDigest.set(
      digest,
      validateIssuancePrincipal(configuredPrincipal),
    );
  }
  return {
    async authenticate({ authorizationHeader }) {
      const match = authorizationHeader?.match(
        /^Bearer ([A-Za-z0-9\-._~+/]{1,4096}={0,2})$/iu,
      );
      const token = match?.[1] ?? "";
      const principal = credentialsByDigest.get(bearerCredentialDigest(token));
      if (!match || !principal) {
        throw new IssuanceAuthorizationError(
          "UNAUTHENTICATED",
          "Bearer credentials are invalid",
        );
      }
      return principal;
    },
  };
}
