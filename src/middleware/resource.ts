/**
 * Resource-server middleware for Express and generic Fetch (P2-05).
 * HUMAN-PROOF verifies unique-human dependency satisfaction only — not app authz.
 */

import type {
  NextFunction,
  Request as ExpressRequest,
  RequestHandler,
  Response as ExpressResponse,
} from "express";
import {
  HUMAN_PROOF_HEADER,
  humanRequiredResponse,
  verifyHumanProofHeader,
} from "../http.js";
import { createHumanRequirement } from "../requirements.js";
import {
  verifyHumanResultToken,
  type ResultVerifier,
  type ResultVerifierKeySet,
} from "../result-token.js";
import { buildCorsHeaders, type X424CorsPolicy } from "../transport.js";
import type {
  HumanBinding,
  HumanMethodDescriptor,
  HumanMethodRequirement,
  HumanRequirement,
  HumanResult,
  RequirementStore,
  ResultReplayStore,
} from "../types.js";

export type BindingExtractor = (input: {
  readonly headers: Headers;
  readonly method: string;
  readonly url: string;
}) => HumanBinding | Promise<HumanBinding>;

export interface ProtectOptions {
  readonly purpose: string;
  readonly audience: string;
  readonly accepts: readonly HumanMethodRequirement[];
  readonly catalog: ReadonlyMap<string, HumanMethodDescriptor>;
  readonly verifier: ResultVerifier | ResultVerifierKeySet;
  readonly extractBinding: BindingExtractor;
  /** Required so retries evaluate the exact server-issued requirement. */
  readonly requirementStore: RequirementStore;
  readonly replayStore?: ResultReplayStore;
  readonly ttlSeconds?: number;
  /** Default true for mutations. */
  readonly requireIdempotencyKey?: boolean;
  readonly providerRequests?: (input: {
    readonly purpose: string;
    readonly binding: HumanBinding;
    readonly accepts: readonly HumanMethodRequirement[];
  }) =>
    | Promise<Readonly<Record<string, unknown>>>
    | Readonly<Record<string, unknown>>;
  readonly cors?: X424CorsPolicy;
  readonly now?: () => Date;
}

function headersFromExpress(request: ExpressRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    }
  }
  return headers;
}

function absoluteUrl(request: ExpressRequest): string {
  const host = request.get("x-forwarded-host") ?? request.get("host");
  if (!host) throw new Error("Cannot determine request host for x424 digest");
  const proto = request.get("x-forwarded-proto") ?? request.protocol;
  return `${proto}://${host}${request.originalUrl}`;
}

async function issueChallenge(
  options: ProtectOptions,
  method: string,
  uri: string,
  binding: HumanBinding,
  body: unknown,
): Promise<HumanRequirement> {
  const providerRequests = options.providerRequests
    ? await options.providerRequests({
        purpose: options.purpose,
        binding,
        accepts: options.accepts,
      })
    : undefined;
  const requirement = createHumanRequirement({
    purpose: options.purpose,
    method,
    uri,
    audience: options.audience,
    ...(body === undefined ? {} : { body }),
    binding,
    accepts: options.accepts,
    ttlSeconds: options.ttlSeconds ?? 300,
    ...(providerRequests === undefined ? {} : { providerRequests }),
  });
  await options.requirementStore.put(requirement);
  return requirement;
}

async function acceptHumanProof(
  options: ProtectOptions,
  humanProof: string,
): Promise<{ requirement: HumanRequirement; result: HumanResult }> {
  const now = options.now?.() ?? new Date();
  const preview = verifyHumanResultToken(humanProof, options.verifier);
  const requirement = await options.requirementStore.get(
    preview.dependencyId,
    now,
  );
  if (!requirement) {
    throw new Error("Unknown or expired human dependency");
  }
  const result = await verifyHumanProofHeader({
    humanProof,
    requirement,
    verifier: options.verifier,
    catalog: options.catalog,
    ...(options.replayStore ? { replayStore: options.replayStore } : {}),
    now,
  });
  await options.requirementStore.delete(requirement.dependencyId);
  return { requirement, result };
}

/**
 * Express middleware: challenge with 424 or verify HUMAN-PROOF then continue.
 * Application authorization remains a separate middleware.
 */
export function createExpressHumanDependencyMiddleware(
  options: ProtectOptions,
): RequestHandler {
  return async (
    request: ExpressRequest,
    response: ExpressResponse,
    next: NextFunction,
  ) => {
    try {
      if (options.cors) {
        const cors = buildCorsHeaders(request.get("origin"), options.cors);
        if (cors) {
          for (const [key, value] of Object.entries(cors)) {
            response.setHeader(key, value);
          }
        } else if (request.get("origin")) {
          return response.status(403).type("application/problem+json").json({
            type: "https://x424.org/problems/cors-origin-denied",
            title: "CORS_ORIGIN_DENIED",
            status: 403,
            detail: "Origin is not allowed for x424 browser access",
          });
        }
        if (request.method === "OPTIONS") {
          return response.status(204).end();
        }
      }

      const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
      if (
        mutation &&
        options.requireIdempotencyKey !== false &&
        !request.get("idempotency-key")
      ) {
        return response.status(400).type("application/problem+json").json({
          type: "https://x424.org/problems/idempotency-key-required",
          title: "IDEMPOTENCY_KEY_REQUIRED",
          status: 400,
          detail:
            "Mutations require Idempotency-Key; x424 does not provide exactly-once business execution",
        });
      }

      const headers = headersFromExpress(request);
      const uri = absoluteUrl(request);
      const binding = await options.extractBinding({
        headers,
        method: request.method,
        url: uri,
      });
      const humanProof = request.get(HUMAN_PROOF_HEADER);

      if (!humanProof) {
        const requirement = await issueChallenge(
          options,
          request.method,
          uri,
          binding,
          request.body,
        );
        const challenge = humanRequiredResponse(requirement);
        for (const [key, value] of Object.entries(challenge.headers)) {
          response.setHeader(key, value);
        }
        return response.status(challenge.status).json(challenge.body);
      }

      const { result } = await acceptHumanProof(options, humanProof);
      (request as ExpressRequest & { x424Result?: HumanResult }).x424Result =
        result;
      return next();
    } catch (error) {
      return response
        .status(401)
        .type("application/problem+json")
        .json({
          type: "https://x424.org/problems/human-proof-rejected",
          title: "HUMAN_PROOF_REJECTED",
          status: 401,
          detail: error instanceof Error ? error.message : "Proof rejected",
        });
    }
  };
}

export interface FetchProtectResult {
  readonly response?: globalThis.Response;
  readonly result?: HumanResult;
  readonly requirement?: HumanRequirement;
}

/**
 * Generic Fetch-style protector for non-Express runtimes.
 */
export async function protectFetchResource(
  request: globalThis.Request,
  options: ProtectOptions & { readonly body?: unknown },
): Promise<FetchProtectResult> {
  if (options.cors) {
    const cors = buildCorsHeaders(request.headers.get("origin"), options.cors);
    if (request.headers.get("origin") && !cors) {
      return {
        response: globalThis.Response.json(
          {
            type: "https://x424.org/problems/cors-origin-denied",
            title: "CORS_ORIGIN_DENIED",
            status: 403,
            detail: "Origin is not allowed for x424 browser access",
          },
          {
            status: 403,
            headers: { "content-type": "application/problem+json" },
          },
        ),
      };
    }
    if (request.method === "OPTIONS") {
      return {
        response: new globalThis.Response(null, {
          status: 204,
          headers: cors ?? {},
        }),
      };
    }
  }

  const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  if (
    mutation &&
    options.requireIdempotencyKey !== false &&
    !request.headers.get("idempotency-key")
  ) {
    return {
      response: globalThis.Response.json(
        {
          type: "https://x424.org/problems/idempotency-key-required",
          title: "IDEMPOTENCY_KEY_REQUIRED",
          status: 400,
          detail:
            "Mutations require Idempotency-Key; x424 does not provide exactly-once business execution",
        },
        { status: 400 },
      ),
    };
  }

  const binding = await options.extractBinding({
    headers: request.headers,
    method: request.method,
    url: request.url,
  });
  const humanProof = request.headers.get(HUMAN_PROOF_HEADER);
  if (!humanProof) {
    const requirement = await issueChallenge(
      options,
      request.method,
      request.url,
      binding,
      options.body,
    );
    const challenge = humanRequiredResponse(requirement);
    return {
      requirement,
      response: globalThis.Response.json(challenge.body, {
        status: challenge.status,
        headers: challenge.headers,
      }),
    };
  }

  const { result, requirement } = await acceptHumanProof(options, humanProof);
  return { result, requirement };
}
