/**
 * Authenticated requirement issuance (P2-02).
 * Missing grants deny. Authentication alone never grants arbitrary issuance.
 */

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
    "__devWildcardIssuance" in principal &&
    principal.__devWildcardIssuance === true
  );
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
  return {
    async authenticate({ authorizationHeader }) {
      if (!authorizationHeader?.startsWith("Bearer ")) {
        throw new IssuanceAuthorizationError(
          "UNAUTHENTICATED",
          "Bearer token required",
        );
      }
      const token = authorizationHeader.slice("Bearer ".length).trim();
      const principal = tokens[token];
      if (!principal) {
        throw new IssuanceAuthorizationError(
          "UNAUTHENTICATED",
          "Unknown bearer token",
        );
      }
      return principal;
    },
  };
}
