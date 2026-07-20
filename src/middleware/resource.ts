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
import type { DeploymentProfile } from "../auth/issuance.js";
import {
  bodyInputFromPlainJsonBody,
  requestDigest,
  type RequestBodyDigestInput,
} from "../canonical.js";
import { InMemoryRequirementStore } from "../requirement-store.js";
import {
  InMemoryResultAcceptanceStore,
  InMemoryResultReplayStore,
} from "../nonce-store.js";
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
import {
  buildCorsHeaders,
  mergeVary,
  resolvePublicAbsoluteUri,
  type PublicOriginConfig,
  type X424CorsPolicy,
} from "../transport.js";
import {
  publicProblem,
  observeInternal,
  type InternalObserver,
} from "../ops/errors.js";
import type {
  HumanBinding,
  HumanMethodDescriptor,
  HumanMethodRequirement,
  HumanRequirement,
  HumanResult,
  RequirementStore,
  ResultAcceptanceStore,
  ResultReplayStore,
} from "../types.js";

export type BindingExtractor = (input: {
  readonly headers: Headers;
  readonly method: string;
  readonly url: string;
}) => HumanBinding | Promise<HumanBinding>;

/** Resolve the actual body for this request; never capture a static digest. */
export type BodyInputExtractor = (input: {
  readonly headers: Headers;
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}) => RequestBodyDigestInput | Promise<RequestBodyDigestInput>;

export interface RequirementIssuanceInput {
  readonly purpose: string;
  readonly method: string;
  readonly uri: string;
  readonly audience: string;
  readonly bodyInput: RequestBodyDigestInput;
  readonly binding: HumanBinding;
  readonly accepts: readonly HumanMethodRequirement[];
  readonly ttlSeconds: number;
  readonly providerRequests?: Readonly<Record<string, unknown>>;
}

/** A self-hosted or managed verifier that creates and retains requirements. */
export interface RequirementIssuer {
  issueRequirement(input: RequirementIssuanceInput): Promise<HumanRequirement>;
}

export interface ProtectOptions {
  readonly deploymentProfile: DeploymentProfile;
  readonly purpose: string;
  readonly audience: string;
  readonly accepts: readonly HumanMethodRequirement[];
  readonly catalog: ReadonlyMap<string, HumanMethodDescriptor>;
  readonly verifier: ResultVerifier | ResultVerifierKeySet;
  readonly extractBinding: BindingExtractor;
  readonly requirementStore: RequirementStore;
  /** Optional remote issuer. When present it owns creation and persistence. */
  readonly requirementIssuer?: RequirementIssuer;
  /** Required for mutations on eval/prod; required for all state-changing acceptance. */
  readonly replayStore?: ResultReplayStore;
  /** Required for idempotent mutations outside dev-local. */
  readonly resultAcceptanceStore?: ResultAcceptanceStore;
  readonly publicOrigin: PublicOriginConfig;
  readonly ttlSeconds?: number;
  readonly requireIdempotencyKey?: boolean;
  readonly extractBodyInput?: BodyInputExtractor;
  readonly providerRequests?: (input: {
    readonly purpose: string;
    readonly binding: HumanBinding;
    readonly accepts: readonly HumanMethodRequirement[];
    readonly ttlSeconds: number;
  }) =>
    | Promise<Readonly<Record<string, unknown>>>
    | Readonly<Record<string, unknown>>;
  readonly cors?: X424CorsPolicy;
  readonly now?: () => Date;
  readonly onInternalError?: InternalObserver;
}

export function assertProtectOptions(options: ProtectOptions): void {
  if (!options.deploymentProfile) {
    throw new Error("deploymentProfile is required");
  }
  if (!options.publicOrigin?.publicOrigin) {
    throw new Error("publicOrigin is required");
  }
  let publicOrigin: URL;
  try {
    publicOrigin = new URL(options.publicOrigin.publicOrigin);
  } catch {
    throw new Error("publicOrigin must be an absolute URL origin");
  }
  if (
    options.deploymentProfile !== "dev-local-0.1" &&
    publicOrigin.protocol !== "https:"
  ) {
    throw new Error("publicOrigin must use HTTPS outside dev-local");
  }
  if (options.deploymentProfile !== "dev-local-0.1" && !options.replayStore) {
    throw new Error(
      "ResultReplayStore is required for eval/prod deployment profiles",
    );
  }
  if (
    options.deploymentProfile !== "dev-local-0.1" &&
    !options.resultAcceptanceStore
  ) {
    throw new Error(
      "ResultAcceptanceStore is required for eval/prod mutation profiles",
    );
  }
  if (
    options.deploymentProfile !== "dev-local-0.1" &&
    options.requirementStore instanceof InMemoryRequirementStore
  ) {
    throw new Error(
      "InMemoryRequirementStore is not permitted outside dev-local",
    );
  }
  if (
    options.deploymentProfile !== "dev-local-0.1" &&
    options.resultAcceptanceStore instanceof InMemoryResultAcceptanceStore
  ) {
    throw new Error(
      "InMemoryResultAcceptanceStore is not permitted outside dev-local",
    );
  }
  if (
    options.deploymentProfile !== "dev-local-0.1" &&
    options.replayStore instanceof InMemoryResultReplayStore
  ) {
    throw new Error(
      "InMemoryResultReplayStore is not permitted outside dev-local",
    );
  }
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

function absoluteUri(
  options: ProtectOptions,
  pathWithQuery: string,
  request: ExpressRequest,
): string {
  return resolvePublicAbsoluteUri({
    config: options.publicOrigin,
    pathWithQuery,
    forwardedHost: request.get("x-forwarded-host") ?? null,
    forwardedProto: request.get("x-forwarded-proto") ?? null,
  });
}

async function resolveBodyInput(
  options: ProtectOptions,
  input: {
    readonly headers: Headers;
    readonly method: string;
    readonly url: string;
    readonly body: unknown;
  },
): Promise<RequestBodyDigestInput> {
  if (options.extractBodyInput) return options.extractBodyInput(input);
  const { body } = input;
  if (body === undefined) return { kind: "absent" };
  return bodyInputFromPlainJsonBody(body);
}

async function issueChallenge(
  options: ProtectOptions,
  method: string,
  uri: string,
  binding: HumanBinding,
  bodyInput: RequestBodyDigestInput,
): Promise<HumanRequirement> {
  const ttlSeconds = options.ttlSeconds ?? 300;
  const providerRequests = options.providerRequests
    ? await options.providerRequests({
        purpose: options.purpose,
        binding,
        accepts: options.accepts,
        ttlSeconds,
      })
    : undefined;
  const issuanceInput: RequirementIssuanceInput = {
    purpose: options.purpose,
    method,
    uri,
    audience: options.audience,
    bodyInput,
    binding,
    accepts: options.accepts,
    ttlSeconds,
    ...(providerRequests === undefined ? {} : { providerRequests }),
  };
  const requirement = options.requirementIssuer
    ? await options.requirementIssuer.issueRequirement(issuanceInput)
    : createHumanRequirement(issuanceInput);
  assertCurrentMatchesStored({
    requirement,
    method,
    uri,
    binding,
    bodyInput,
    purpose: options.purpose,
    audience: options.audience,
  });
  if (!options.requirementIssuer) {
    await options.requirementStore.put(requirement);
  }
  return requirement;
}

function assertCurrentMatchesStored(input: {
  readonly requirement: HumanRequirement;
  readonly method: string;
  readonly uri: string;
  readonly binding: HumanBinding;
  readonly bodyInput: RequestBodyDigestInput;
  readonly purpose: string;
  readonly audience: string;
}): void {
  const { requirement } = input;
  if (requirement.purpose !== input.purpose) {
    throw new Error("Purpose does not match the stored dependency");
  }
  if (requirement.resource.audience !== input.audience) {
    throw new Error("Audience does not match the stored dependency");
  }
  if (requirement.resource.method !== input.method.toUpperCase()) {
    throw new Error("HTTP method does not match the stored dependency");
  }
  if (requirement.resource.uri !== input.uri) {
    throw new Error("Request URI does not match the stored dependency");
  }
  const currentDigest = requestDigest({
    method: input.method,
    uri: input.uri,
    bodyInput: input.bodyInput,
  });
  if (requirement.resource.requestDigest !== currentDigest) {
    throw new Error("Request body digest does not match the stored dependency");
  }
  if (
    requirement.binding.kind !== input.binding.kind ||
    requirement.binding.value !== input.binding.value
  ) {
    throw new Error("Caller binding does not match the stored dependency");
  }
}

async function acceptHumanProof(
  options: ProtectOptions,
  humanProof: string,
  current: {
    readonly method: string;
    readonly uri: string;
    readonly binding: HumanBinding;
    readonly bodyInput: RequestBodyDigestInput;
    readonly operationId?: string;
  },
): Promise<{ requirement: HumanRequirement; result: HumanResult }> {
  const now = options.now?.() ?? new Date();
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(
    current.method.toUpperCase(),
  );
  if (options.deploymentProfile !== "dev-local-0.1" && !options.replayStore) {
    throw new Error("ResultReplayStore is required for this profile");
  }
  if (
    mutation &&
    options.deploymentProfile !== "dev-local-0.1" &&
    (!options.resultAcceptanceStore || !current.operationId)
  ) {
    throw new Error(
      "ResultAcceptanceStore and Idempotency-Key are required for mutations",
    );
  }

  const preview = verifyHumanResultToken(humanProof, options.verifier);
  const requirement = await options.requirementStore.get(
    preview.dependencyId,
    now,
  );
  if (!requirement) {
    throw new Error("Unknown or expired human dependency");
  }

  assertCurrentMatchesStored({
    requirement,
    method: current.method,
    uri: current.uri,
    binding: current.binding,
    bodyInput: current.bodyInput,
    purpose: options.purpose,
    audience: options.audience,
  });

  const useAcceptance =
    mutation &&
    options.resultAcceptanceStore !== undefined &&
    current.operationId !== undefined;
  const result = await verifyHumanProofHeader({
    humanProof,
    requirement,
    verifier: options.verifier,
    catalog: options.catalog,
    ...(!useAcceptance && options.replayStore
      ? { replayStore: options.replayStore }
      : {}),
    requireReplayStore:
      !useAcceptance &&
      (mutation || options.deploymentProfile !== "dev-local-0.1"),
    now,
  });
  if (useAcceptance) {
    const status = await options.resultAcceptanceStore!.accept(
      {
        resultId: result.resultId,
        operationId: current.operationId!,
        requestDigest: result.requestDigest,
        expiresAt: result.expiresAt,
      },
      now,
    );
    if (status === "replay") {
      throw new Error("x424 result token was replayed for another operation");
    }
  }
  // Mutation requirements remain available until TTL so the same idempotent
  // operation can cross another dependency such as x402. Acceptance state is
  // the gate; requirement deletion is only eager cleanup for one-shot reads.
  if (!mutation) {
    await options.requirementStore.delete(requirement.dependencyId);
  }
  return { requirement, result };
}

/**
 * Express middleware: challenge with 424 or verify HUMAN-PROOF then continue.
 */
export function createExpressHumanDependencyMiddleware(
  options: ProtectOptions,
): RequestHandler {
  assertProtectOptions(options);
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
          const problem = publicProblem(403, "CORS_ORIGIN_DENIED");
          return response
            .status(problem.status)
            .type("application/problem+json")
            .json(problem);
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
        const problem = publicProblem(400, "IDEMPOTENCY_KEY_REQUIRED");
        return response
          .status(problem.status)
          .type("application/problem+json")
          .json(problem);
      }

      const headers = headersFromExpress(request);
      const uri = absoluteUri(options, request.originalUrl, request);
      const binding = await options.extractBinding({
        headers,
        method: request.method,
        url: uri,
      });
      const bodyInput = await resolveBodyInput(options, {
        headers,
        method: request.method,
        url: uri,
        body: request.body,
      });
      const humanProof = request.get(HUMAN_PROOF_HEADER);

      if (!humanProof) {
        const requirement = await issueChallenge(
          options,
          request.method,
          uri,
          binding,
          bodyInput,
        );
        const challenge = humanRequiredResponse(requirement);
        for (const [key, value] of Object.entries(challenge.headers)) {
          response.setHeader(
            key,
            key.toLowerCase() === "vary"
              ? mergeVary(response.getHeader("vary"), value)
              : value,
          );
        }
        return response.status(challenge.status).json(challenge.body);
      }

      const { result } = await acceptHumanProof(options, humanProof, {
        method: request.method,
        uri,
        binding,
        bodyInput,
        ...(request.get("idempotency-key")
          ? { operationId: request.get("idempotency-key")! }
          : {}),
      });
      (request as ExpressRequest & { x424Result?: HumanResult }).x424Result =
        result;
      return next();
    } catch (error) {
      observeInternal(
        options.onInternalError,
        "HUMAN_PROOF_REJECTED",
        401,
        error,
      );
      const problem = publicProblem(401, "HUMAN_PROOF_REJECTED");
      return response
        .status(problem.status)
        .type("application/problem+json")
        .json(problem);
    }
  };
}

export interface FetchProtectResult {
  readonly response?: globalThis.Response;
  readonly result?: HumanResult;
  readonly requirement?: HumanRequirement;
}

export async function protectFetchResource(
  request: globalThis.Request,
  options: ProtectOptions & {
    readonly body?: unknown;
    /** Per-request explicit input for non-JSON/streamed bodies. */
    readonly bodyInput?: RequestBodyDigestInput;
  },
): Promise<FetchProtectResult> {
  assertProtectOptions(options);
  let cors: Record<string, string> | null = null;
  if (options.cors) {
    cors = buildCorsHeaders(request.headers.get("origin"), options.cors);
    if (request.headers.get("origin") && !cors) {
      const problem = publicProblem(403, "CORS_ORIGIN_DENIED");
      return {
        response: globalThis.Response.json(problem, {
          status: problem.status,
          headers: {
            "content-type": "application/problem+json",
            ...(cors ?? {}),
          },
        }),
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
    const problem = publicProblem(400, "IDEMPOTENCY_KEY_REQUIRED");
    return {
      response: globalThis.Response.json(problem, {
        status: problem.status,
        headers: cors ?? {},
      }),
    };
  }

  const parsedUrl = new URL(request.url);
  const configuredOrigin = new URL(options.publicOrigin.publicOrigin);
  const uri =
    parsedUrl.origin === configuredOrigin.origin
      ? parsedUrl.href
      : resolvePublicAbsoluteUri({
          config: options.publicOrigin,
          pathWithQuery: `${parsedUrl.pathname}${parsedUrl.search}`,
        });
  const binding = await options.extractBinding({
    headers: request.headers,
    method: request.method,
    url: uri,
  });
  const bodyInput =
    options.bodyInput ??
    (await resolveBodyInput(options, {
      headers: request.headers,
      method: request.method,
      url: uri,
      body: options.body,
    }));
  const humanProof = request.headers.get(HUMAN_PROOF_HEADER);
  if (!humanProof) {
    const requirement = await issueChallenge(
      options,
      request.method,
      uri,
      binding,
      bodyInput,
    );
    const challenge = humanRequiredResponse(requirement);
    return {
      requirement,
      response: globalThis.Response.json(challenge.body, {
        status: challenge.status,
        headers: {
          ...(cors ?? {}),
          ...challenge.headers,
          vary: mergeVary(cors?.vary, challenge.headers.vary ?? ""),
        },
      }),
    };
  }

  try {
    const { result, requirement } = await acceptHumanProof(
      options,
      humanProof,
      {
        method: request.method,
        uri,
        binding,
        bodyInput,
        ...(request.headers.get("idempotency-key")
          ? { operationId: request.headers.get("idempotency-key")! }
          : {}),
      },
    );
    return { result, requirement };
  } catch (error) {
    observeInternal(
      options.onInternalError,
      "HUMAN_PROOF_REJECTED",
      401,
      error,
    );
    const problem = publicProblem(401, "HUMAN_PROOF_REJECTED");
    return {
      response: globalThis.Response.json(problem, {
        status: problem.status,
        headers: cors ?? {},
      }),
    };
  }
}
