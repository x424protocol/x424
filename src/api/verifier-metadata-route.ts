import { createHash } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import type { IssuanceAuthenticator } from "../auth/issuance.js";
import type { RateLimitResult } from "../ops/limits.js";

export interface VerifierMetadataRouteOptions {
  readonly token: string;
  readonly issuanceAuthenticator: IssuanceAuthenticator;
  readonly rateLimiter: {
    consume(key: string): RateLimitResult | Promise<RateLimitResult>;
  };
}

function networkActor(request: Request): string {
  return createHash("sha256")
    .update(request.ip ?? "unknown", "utf8")
    .digest("base64url");
}

function sendProblem(
  response: Response,
  status: number,
  code: "RATE_LIMITED" | "SERVICE_UNAVAILABLE" | "UNAUTHENTICATED",
  detail: string,
): void {
  response
    .status(status)
    .type("application/problem+json")
    .json({
      type: `https://x424.org/problems/${code.toLowerCase().replaceAll("_", "-")}`,
      title: code,
      status,
      detail,
    });
}

/**
 * Authenticated verifier metadata route with a durable pre-authentication
 * network limit. Raw bearer credentials and network addresses never enter
 * limiter keys.
 */
export function createVerifierMetadataHandler(
  options: VerifierMetadataRouteOptions,
): RequestHandler {
  if (!options.token || options.token.length > 65_536) {
    throw new Error(
      "Verifier metadata token must contain between 1 and 65536 characters",
    );
  }
  return async (request: Request, response: Response): Promise<void> => {
    response.setHeader("cache-control", "no-store, private");
    response.vary("Authorization");

    let limit: RateLimitResult;
    try {
      limit = await options.rateLimiter.consume(
        `metadata:authenticate:ip:${networkActor(request)}`,
      );
    } catch {
      sendProblem(
        response,
        503,
        "SERVICE_UNAVAILABLE",
        "Verifier metadata authentication is temporarily unavailable.",
      );
      return;
    }

    response.setHeader("x-ratelimit-remaining", String(limit.remaining));
    if (!limit.allowed) {
      response.setHeader(
        "retry-after",
        String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1_000))),
      );
      sendProblem(
        response,
        429,
        "RATE_LIMITED",
        "Verifier metadata authentication rate limit exceeded.",
      );
      return;
    }

    try {
      await options.issuanceAuthenticator.authenticate({
        authorizationHeader: request.get("authorization") ?? null,
      });
      response.json({ token: options.token });
    } catch {
      response.setHeader(
        "www-authenticate",
        'Bearer realm="x424-verifier-metadata"',
      );
      sendProblem(
        response,
        401,
        "UNAUTHENTICATED",
        "Authentication is required.",
      );
    }
  };
}
