/**
 * Authenticated requirement issuance (P2-02).
 * Authentication alone must not grant arbitrary issuance.
 */

export interface IssuancePrincipal {
  readonly subject: string;
  readonly issuer?: string;
  readonly audiences?: readonly string[];
  /** Exact method keys `providerId:methodId` this principal may request. */
  readonly allowedMethods?: readonly string[];
  readonly allowedPurposes?: readonly string[];
  /** Glob-like URI prefixes permitted for protected resources. */
  readonly allowedResourceUriPrefixes?: readonly string[];
  readonly allowedAudiences?: readonly string[];
}

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
  }): Promise<IssuancePrincipal>;
}

export class IssuanceAuthorizationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "IssuanceAuthorizationError";
    this.code = code;
  }
}

export function authorizeIssuance(
  principal: IssuancePrincipal,
  request: IssuanceAuthorizationRequest,
): void {
  if (
    principal.allowedPurposes &&
    !principal.allowedPurposes.includes(request.purpose)
  ) {
    throw new IssuanceAuthorizationError(
      "PURPOSE_NOT_AUTHORIZED",
      "Issuer is not authorized for this purpose",
    );
  }
  if (
    principal.allowedAudiences &&
    !principal.allowedAudiences.includes(request.audience)
  ) {
    throw new IssuanceAuthorizationError(
      "AUDIENCE_NOT_AUTHORIZED",
      "Issuer is not authorized for this audience",
    );
  }
  if (principal.allowedResourceUriPrefixes) {
    const ok = principal.allowedResourceUriPrefixes.some((prefix) =>
      request.uri.startsWith(prefix),
    );
    if (!ok) {
      throw new IssuanceAuthorizationError(
        "RESOURCE_NOT_AUTHORIZED",
        "Issuer is not authorized for this resource URI",
      );
    }
  }
  if (principal.allowedMethods) {
    for (const method of request.accepts) {
      const key = `${method.providerId}:${method.methodId}`;
      if (!principal.allowedMethods.includes(key)) {
        throw new IssuanceAuthorizationError(
          "METHOD_NOT_AUTHORIZED",
          "Issuer is not authorized for an accepted method",
        );
      }
    }
  }
}

/** Bearer token authenticator for evaluation profiles. Not a full OAuth AS. */
export function createStaticBearerIssuanceAuthenticator(
  tokens: Readonly<Record<string, IssuancePrincipal>>,
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
