import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  assertIssuanceRouterConfig,
  authorizeIssuance,
  IssuanceAuthorizationError,
  validateIssuancePrincipal,
  type AnyIssuancePrincipal,
  type DeploymentProfile,
  type IssuanceAuthenticator,
} from "../auth/issuance.js";
import { HUMAN_METHOD_IDENTIFIER_PATTERN } from "../catalog.js";
import {
  bodyInputFromPlainJsonBody,
  sha256,
  type RequestBodyDigestInput,
} from "../canonical.js";
import { decodeStrictBase64Url } from "../encoding.js";
import { HUMAN_RESULT_HEADER, humanRequiredResponse } from "../http.js";
import type { HumanHandoffService } from "../handoff.js";
import {
  classifyVerifierError,
  observeInternal,
  publicProblem,
  type InternalObserver,
} from "../ops/errors.js";
import { createHumanRequirement } from "../requirements.js";
import { InMemoryRequirementStore } from "../requirement-store.js";
import { MemoryRateLimiter } from "../ops/limits.js";
import { parseHumanProofSubmission } from "../schemas.js";
import type { X424Service } from "../service.js";
import type {
  HumanBinding,
  HumanMethodRequirement,
  LegacyAwareResultAcceptanceStore,
  LegacyAwareResultReplayStore,
  RequirementStore,
  ResultAcceptanceStore,
  ResultReplayStore,
  TenantIsolatedRequirementStore,
} from "../types.js";

const MethodSchema = z
  .object({
    providerId: z.string().regex(HUMAN_METHOD_IDENTIFIER_PATTERN),
    methodId: z.string().regex(HUMAN_METHOD_IDENTIFIER_PATTERN),
    descriptorVersion: z.string().min(1).max(50),
    assuranceLevel: z.string().min(1).max(100).optional(),
    acceptedScopeKinds: z
      .array(z.enum(["global", "relying_party", "action", "session"]))
      .min(1),
    maximumProofAgeSeconds: z.number().int().positive().max(86_400).optional(),
    verificationModes: z
      .array(z.enum(["backend", "offchain", "onchain", "hybrid"]))
      .min(1)
      .optional(),
  })
  .strict();

const BodyInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("absent") }).strict(),
  z.object({ kind: z.literal("empty") }).strict(),
  z.object({ kind: z.literal("json"), value: z.unknown() }).strict(),
  z
    .object({
      kind: z.literal("opaque"),
      bytesBase64url: z.string().min(1).max(350_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("precomputed"),
      bodyDigest: z.string().min(1).max(50),
    })
    .strict(),
]);

const CreateSchema = z
  .object({
    purpose: z.string().min(1).max(200),
    method: z.string().min(1).max(20),
    uri: z.string().url().max(2_048),
    audience: z.string().url().max(2_048),
    /** @deprecated Prefer bodyInput. Plain JSON object/array only. */
    body: z.unknown().optional(),
    bodyInput: BodyInputSchema.optional(),
    binding: z
      .object({
        kind: z.enum(["request", "wallet", "agent_key", "session"]),
        value: z.string().min(1).max(512),
      })
      .strict(),
    accepts: z.array(MethodSchema).min(1).max(10),
    providerRequests: z
      .record(z.string().min(3).max(201), z.unknown())
      .optional(),
    ttlSeconds: z.number().int().min(30).max(900).default(300),
  })
  .strict();

function resolveIssuanceBodyInput(
  bodyInput: z.infer<typeof BodyInputSchema> | undefined,
  body: unknown,
): RequestBodyDigestInput {
  if (bodyInput !== undefined) {
    switch (bodyInput.kind) {
      case "absent":
      case "empty":
        return { kind: bodyInput.kind };
      case "json":
        return { kind: "json", value: bodyInput.value };
      case "opaque":
        return {
          kind: "opaque",
          bytes: decodeStrictBase64Url(
            bodyInput.bytesBase64url,
            "opaque body bytes",
          ),
        };
      case "precomputed":
        return {
          kind: "precomputed",
          bodyDigest: bodyInput.bodyDigest,
        };
      default: {
        const _exhaustive: never = bodyInput;
        return _exhaustive;
      }
    }
  }
  return bodyInputFromPlainJsonBody(body);
}

const ProofSchema = z
  .object({
    x424Version: z.literal("0.1"),
    dependencyId: z.string().min(1).max(200),
    providerId: z.string().regex(HUMAN_METHOD_IDENTIFIER_PATTERN),
    methodId: z.string().regex(HUMAN_METHOD_IDENTIFIER_PATTERN),
    binding: z
      .object({
        kind: z.enum(["request", "wallet", "agent_key", "session"]),
        value: z.string().min(1).max(512),
      })
      .strict(),
    nativeProof: z.unknown(),
  })
  .strict();

const ResultConsumeSchema = z
  .object({ expiresAt: z.string().datetime() })
  .strict();

const ResultAcceptanceSchema = z
  .object({
    operationId: z.string().min(1).max(512),
    requestDigest: z.string().regex(/^sha256:[A-Za-z0-9_-]{43}$/u),
    expiresAt: z.string().datetime(),
  })
  .strict();

const StateResourceIdSchema = z.string().min(1).max(200);
const MAXIMUM_STATE_TTL_SECONDS = 900;

const StartHandoffSchema = z
  .object({
    nonce: z.string().min(1).max(512),
    providerId: z.string().regex(HUMAN_METHOD_IDENTIFIER_PATTERN),
    methodId: z.string().regex(HUMAN_METHOD_IDENTIFIER_PATTERN),
  })
  .strict();

export interface X424HttpRouterOptions {
  readonly service: X424Service;
  /** Verifier-generated provider material. Mutually exclusive with issuer mode. */
  readonly providerRequests?: (input: {
    readonly purpose: string;
    readonly binding: HumanBinding;
    readonly accepts: readonly HumanMethodRequirement[];
    readonly ttlSeconds: number;
  }) => Promise<Readonly<Record<string, unknown>>>;
  /**
   * Accept authenticated issuer-supplied provider material. Adapter validation
   * still runs before the dependency nonce is registered.
   */
  readonly allowIssuerProviderRequests?: boolean;
  readonly requirementStore?: RequirementStore;
  /** Optional authenticated remote replay endpoint backing resource servers. */
  readonly resultReplayStore?: ResultReplayStore;
  /** Optional authenticated idempotent-mutation acceptance endpoint. */
  readonly resultAcceptanceStore?: ResultAcceptanceStore;
  readonly handoffService?: HumanHandoffService;
  readonly maximumPendingRequirements?: number;
  readonly issuanceAuthenticator?: IssuanceAuthenticator;
  readonly allowUnauthenticatedIssuance?: boolean;
  readonly rateLimiter?: {
    consume(key: string):
      | {
          allowed: boolean;
          remaining: number;
          resetAt: number;
        }
      | Promise<{
          allowed: boolean;
          remaining: number;
          resetAt: number;
        }>;
  };
  /**
   * Upper bound for caller-presented result state. It may be reduced for
   * deployments with shorter result lifetimes, but never exceeds the protocol
   * requirement TTL ceiling.
   */
  readonly maximumStateTtlSeconds?: number;
  /** Readiness check for durable state and verifier dependencies. Required outside dev-local. */
  readonly readinessCheck?: () => void | Promise<void>;
  /** Required. Omission does not select dev-local. */
  readonly deploymentProfile: DeploymentProfile;
  readonly onInternalError?: InternalObserver;
}

function exactMethods(
  methods: z.infer<typeof MethodSchema>[],
): HumanMethodRequirement[] {
  return methods.map((method) => ({
    providerId: method.providerId,
    methodId: method.methodId,
    descriptorVersion: method.descriptorVersion,
    acceptedScopeKinds: method.acceptedScopeKinds,
    ...(method.assuranceLevel === undefined
      ? {}
      : { assuranceLevel: method.assuranceLevel }),
    ...(method.maximumProofAgeSeconds === undefined
      ? {}
      : { maximumProofAgeSeconds: method.maximumProofAgeSeconds }),
    ...(method.verificationModes === undefined
      ? {}
      : { verificationModes: method.verificationModes }),
  }));
}

function sendProblem(
  response: Response,
  status: number,
  code: string,
): Response {
  const problem = publicProblem(status, code);
  return response
    .status(problem.status)
    .type("application/problem+json")
    .json(problem);
}

function isTenantIsolatedRequirementStore(
  store: RequirementStore,
): store is TenantIsolatedRequirementStore {
  const candidate = store as Partial<TenantIsolatedRequirementStore>;
  return (
    candidate.tenantIsolation === true &&
    typeof candidate.putForTenant === "function" &&
    typeof candidate.getForTenant === "function" &&
    typeof candidate.deleteForTenant === "function"
  );
}

function isLegacyAwareResultReplayStore(
  store: ResultReplayStore,
): store is LegacyAwareResultReplayStore {
  const candidate = store as Partial<LegacyAwareResultReplayStore>;
  return (
    candidate.legacyResultStateMigration === true &&
    typeof candidate.consumeWithLegacy === "function"
  );
}

function isLegacyAwareResultAcceptanceStore(
  store: ResultAcceptanceStore,
): store is LegacyAwareResultAcceptanceStore {
  const candidate = store as Partial<LegacyAwareResultAcceptanceStore>;
  return (
    candidate.legacyResultStateMigration === true &&
    typeof candidate.acceptWithLegacy === "function"
  );
}

function scopedStateId(tenantId: string, stateId: string): string {
  return sha256(`x424-state-v1\u0000${tenantId}\u0000${stateId}`);
}

function tenantStateId(principal: AnyIssuancePrincipal): string {
  const issuer =
    "issuer" in principal && principal.issuer !== undefined
      ? principal.issuer
      : "";
  return sha256(`x424-tenant-v2\u0000${issuer}\u0000${principal.subject}`);
}

function networkStateId(request: Request): string {
  return sha256(request.ip ?? "unknown");
}

function boundedFutureExpiry(
  expiresAt: string,
  maximumTtlSeconds: number,
  now = Date.now(),
): boolean {
  const expiresAtMs = Date.parse(expiresAt);
  return (
    Number.isFinite(expiresAtMs) &&
    expiresAtMs > now &&
    expiresAtMs <= now + maximumTtlSeconds * 1_000
  );
}

/**
 * Reference API router. Construction fails closed for misconfigured profiles.
 */
export function createX424HttpRouter(options: X424HttpRouterOptions): Router {
  if (
    (options.providerRequests === undefined) ===
    (options.allowIssuerProviderRequests !== true)
  ) {
    throw new Error(
      "Configure exactly one provider-request source: verifier or issuer",
    );
  }
  const profile = assertIssuanceRouterConfig({
    deploymentProfile: options.deploymentProfile,
    ...(options.allowUnauthenticatedIssuance === undefined
      ? {}
      : { allowUnauthenticatedIssuance: options.allowUnauthenticatedIssuance }),
    ...(options.issuanceAuthenticator === undefined
      ? {}
      : { issuanceAuthenticator: options.issuanceAuthenticator }),
  });
  const router = Router();
  if (profile !== "dev-local-0.1") {
    if (
      !options.requirementStore ||
      options.requirementStore instanceof InMemoryRequirementStore
    ) {
      throw new Error(
        "A durable shared RequirementStore is required outside dev-local",
      );
    }
    if (
      !options.rateLimiter ||
      options.rateLimiter instanceof MemoryRateLimiter
    ) {
      throw new Error(
        "A durable shared rate limiter is required outside dev-local",
      );
    }
    if (!options.readinessCheck) {
      throw new Error("A readinessCheck is required outside dev-local");
    }
  }
  const requirementStore =
    options.requirementStore ??
    new InMemoryRequirementStore(options.maximumPendingRequirements ?? 10_000);
  const tenantRequirementStore = isTenantIsolatedRequirementStore(
    requirementStore,
  )
    ? requirementStore
    : undefined;
  if (options.issuanceAuthenticator && !tenantRequirementStore) {
    throw new Error(
      "Authenticated verifier APIs require a TenantIsolatedRequirementStore",
    );
  }
  if (
    options.issuanceAuthenticator &&
    options.resultReplayStore &&
    !isLegacyAwareResultReplayStore(options.resultReplayStore)
  ) {
    throw new Error(
      "Authenticated verifier APIs require a LegacyAwareResultReplayStore",
    );
  }
  if (
    options.issuanceAuthenticator &&
    options.resultAcceptanceStore &&
    !isLegacyAwareResultAcceptanceStore(options.resultAcceptanceStore)
  ) {
    throw new Error(
      "Authenticated verifier APIs require a LegacyAwareResultAcceptanceStore",
    );
  }
  const maximumStateTtlSeconds =
    options.maximumStateTtlSeconds ?? MAXIMUM_STATE_TTL_SECONDS;
  if (
    !Number.isInteger(maximumStateTtlSeconds) ||
    maximumStateTtlSeconds < 1 ||
    maximumStateTtlSeconds > MAXIMUM_STATE_TTL_SECONDS
  ) {
    throw new Error(
      `maximumStateTtlSeconds must be between 1 and ${MAXIMUM_STATE_TTL_SECONDS}`,
    );
  }

  const authenticateStateRequest = async (
    request: Request,
  ): Promise<AnyIssuancePrincipal | undefined> => {
    if (options.issuanceAuthenticator) {
      const principal = validateIssuancePrincipal(
        await options.issuanceAuthenticator.authenticate({
          authorizationHeader: request.get("authorization") ?? null,
        }),
      );
      if (profile !== "dev-local-0.1" && "__devWildcardIssuance" in principal) {
        throw new IssuanceAuthorizationError(
          "UNAUTHENTICATED",
          "Authenticated issuer principal is invalid",
        );
      }
      return principal;
    }
    return undefined;
  };

  const consumeStateAuthenticationRateLimit = async (
    request: Request,
    response: Response,
  ): Promise<boolean> => {
    if (!options.issuanceAuthenticator || !options.rateLimiter) return true;
    const networkActor = networkStateId(request);
    const limit = await options.rateLimiter.consume(
      `state:authenticate:ip:${networkActor}`,
    );
    response.setHeader("x-ratelimit-remaining", String(limit.remaining));
    if (limit.allowed) return true;
    response.setHeader(
      "retry-after",
      String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1_000))),
    );
    sendProblem(response, 429, "RATE_LIMITED");
    return false;
  };

  const consumeStateRateLimit = async (
    request: Request,
    response: Response,
    action: string,
    principal: AnyIssuancePrincipal | undefined,
  ): Promise<boolean> => {
    if (!options.rateLimiter) return true;
    const actor =
      principal === undefined
        ? `ip:${networkStateId(request)}`
        : `tenant:${tenantStateId(principal)}`;
    const limit = await options.rateLimiter.consume(`state:${action}:${actor}`);
    response.setHeader("x-ratelimit-remaining", String(limit.remaining));
    if (limit.allowed) return true;
    response.setHeader(
      "retry-after",
      String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1_000))),
    );
    sendProblem(response, 429, "RATE_LIMITED");
    return false;
  };

  const handoffBearer = (request: Request): string | undefined => {
    const authorization = request.get("authorization");
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/u);
    return match?.[1];
  };

  router.post(
    "/v1/requirements",
    async (request: Request, response: Response) => {
      if (options.rateLimiter) {
        const limit = await options.rateLimiter.consume(
          `issue:ip:${networkStateId(request)}`,
        );
        response.setHeader("x-ratelimit-remaining", String(limit.remaining));
        if (!limit.allowed) {
          response.setHeader("retry-after", "1");
          return sendProblem(response, 429, "RATE_LIMITED");
        }
      }
      const parsed = CreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendProblem(response, 400, "INVALID_REQUIREMENT");
      }
      try {
        let tenantId: string | undefined;
        if (options.issuanceAuthenticator) {
          const principal = validateIssuancePrincipal(
            await options.issuanceAuthenticator.authenticate({
              authorizationHeader: request.get("authorization") ?? null,
            }),
          );
          authorizeIssuance(
            principal,
            {
              purpose: parsed.data.purpose,
              method: parsed.data.method,
              uri: parsed.data.uri,
              audience: parsed.data.audience,
              accepts: parsed.data.accepts,
            },
            profile,
          );
          tenantId = tenantStateId(principal);
        }
        const accepts = exactMethods(parsed.data.accepts);
        let providerRequests: Readonly<Record<string, unknown>>;
        if (options.providerRequests) {
          if (parsed.data.providerRequests !== undefined) {
            throw new Error(
              "Issuer provider requests are disabled for this verifier",
            );
          }
          providerRequests = await options.providerRequests({
            purpose: parsed.data.purpose,
            binding: parsed.data.binding,
            accepts,
            ttlSeconds: parsed.data.ttlSeconds,
          });
        } else {
          if (parsed.data.providerRequests === undefined) {
            throw new Error(
              "Authenticated issuer provider requests are required",
            );
          }
          providerRequests = parsed.data.providerRequests;
        }
        const requirement = createHumanRequirement({
          purpose: parsed.data.purpose,
          method: parsed.data.method,
          uri: parsed.data.uri,
          audience: parsed.data.audience,
          bodyInput: resolveIssuanceBodyInput(
            parsed.data.bodyInput,
            parsed.data.body,
          ),
          binding: parsed.data.binding,
          accepts,
          ttlSeconds: parsed.data.ttlSeconds,
          providerRequests,
        });
        if (tenantId === undefined) {
          await requirementStore.put(requirement);
        } else {
          await tenantRequirementStore!.putForTenant(requirement, tenantId);
        }
        try {
          await options.service.register(requirement);
        } catch (error) {
          await requirementStore.delete(requirement.dependencyId);
          throw error;
        }
        const challenge = humanRequiredResponse(requirement);
        for (const [key, value] of Object.entries(challenge.headers)) {
          response.setHeader(key, value);
        }
        return response.status(201).json({
          requirement,
          x424Transport: challenge.transport,
        });
      } catch (error) {
        observeInternal(
          options.onInternalError,
          "REQUIREMENT_REJECTED",
          400,
          error,
        );
        if (error instanceof IssuanceAuthorizationError) {
          return sendProblem(
            response,
            error.code === "UNAUTHENTICATED" ? 401 : 403,
            error.code,
          );
        }
        return sendProblem(response, 400, "REQUIREMENT_REJECTED");
      }
    },
  );

  router.get(
    "/v1/requirements/:dependencyId",
    async (request: Request, response: Response) => {
      response.set("cache-control", "no-store, private");
      response.vary("authorization");
      const parsedDependencyId = StateResourceIdSchema.safeParse(
        request.params.dependencyId,
      );
      if (!parsedDependencyId.success) {
        return sendProblem(response, 400, "INVALID_DEPENDENCY");
      }
      const dependencyId = parsedDependencyId.data;
      try {
        if (!(await consumeStateAuthenticationRateLimit(request, response))) {
          return response;
        }
        const principal = await authenticateStateRequest(request);
        if (
          !(await consumeStateRateLimit(
            request,
            response,
            "requirement-read",
            principal,
          ))
        ) {
          return response;
        }
        const requirement =
          principal === undefined
            ? await requirementStore.get(dependencyId)
            : await tenantRequirementStore!.getForTenant(
                dependencyId,
                tenantStateId(principal),
              );
        if (!requirement) {
          return sendProblem(response, 404, "DEPENDENCY_NOT_FOUND");
        }
        return response.json({ requirement });
      } catch (error) {
        observeInternal(
          options.onInternalError,
          "STATE_READ_REJECTED",
          401,
          error,
        );
        return sendProblem(response, 401, "STATE_READ_REJECTED");
      }
    },
  );

  router.delete(
    "/v1/requirements/:dependencyId",
    async (request: Request, response: Response) => {
      response.set("cache-control", "no-store, private");
      response.vary("authorization");
      const parsedDependencyId = StateResourceIdSchema.safeParse(
        request.params.dependencyId,
      );
      if (!parsedDependencyId.success) {
        return sendProblem(response, 400, "INVALID_DEPENDENCY");
      }
      const dependencyId = parsedDependencyId.data;
      try {
        if (!(await consumeStateAuthenticationRateLimit(request, response))) {
          return response;
        }
        const principal = await authenticateStateRequest(request);
        if (
          !(await consumeStateRateLimit(
            request,
            response,
            "requirement-delete",
            principal,
          ))
        ) {
          return response;
        }
        if (principal === undefined) {
          await requirementStore.delete(dependencyId);
        } else if (
          !(await tenantRequirementStore!.deleteForTenant(
            dependencyId,
            tenantStateId(principal),
          ))
        ) {
          return sendProblem(response, 404, "DEPENDENCY_NOT_FOUND");
        }
        return response.status(204).end();
      } catch (error) {
        observeInternal(
          options.onInternalError,
          "STATE_DELETE_REJECTED",
          401,
          error,
        );
        return sendProblem(response, 401, "STATE_DELETE_REJECTED");
      }
    },
  );

  router.post(
    "/v1/requirements/:dependencyId/handoffs",
    async (request: Request, response: Response) => {
      if (!options.handoffService) {
        return sendProblem(response, 404, "HANDOFF_DISABLED");
      }
      const dependencyId = request.params.dependencyId;
      const parsed = StartHandoffSchema.safeParse(request.body);
      if (typeof dependencyId !== "string" || !parsed.success) {
        return sendProblem(response, 400, "INVALID_HANDOFF");
      }
      try {
        if (options.rateLimiter) {
          const limit = await options.rateLimiter.consume(
            `handoff:ip:${networkStateId(request)}`,
          );
          if (!limit.allowed) return sendProblem(response, 429, "RATE_LIMITED");
        }
        const started = await options.handoffService.start({
          dependencyId,
          nonce: parsed.data.nonce,
          providerId: parsed.data.providerId,
          methodId: parsed.data.methodId,
        });
        response.set("cache-control", "no-store, private");
        return response.status(201).json(started);
      } catch (error) {
        observeInternal(
          options.onInternalError,
          "HANDOFF_REJECTED",
          400,
          error,
        );
        return sendProblem(response, 400, "HANDOFF_REJECTED");
      }
    },
  );

  router.get(
    "/v1/handoffs/:handoffId",
    async (request: Request, response: Response) => {
      response.set("cache-control", "no-store, private");
      response.vary("authorization");
      if (!options.handoffService) {
        return sendProblem(response, 404, "HANDOFF_DISABLED");
      }
      const handoffId = request.params.handoffId;
      const accessToken = handoffBearer(request);
      if (typeof handoffId !== "string" || !accessToken) {
        return sendProblem(response, 401, "HANDOFF_UNAUTHORIZED");
      }
      try {
        if (
          !(await consumeStateRateLimit(
            request,
            response,
            "handoff-poll",
            undefined,
          ))
        ) {
          return response;
        }
        const view = await options.handoffService.poll(handoffId, accessToken);
        return response.json(view);
      } catch (error) {
        observeInternal(
          options.onInternalError,
          "HANDOFF_UNAUTHORIZED",
          401,
          error,
        );
        return sendProblem(response, 401, "HANDOFF_UNAUTHORIZED");
      }
    },
  );

  router.delete(
    "/v1/handoffs/:handoffId",
    async (request: Request, response: Response) => {
      response.set("cache-control", "no-store, private");
      response.vary("authorization");
      if (!options.handoffService) {
        return sendProblem(response, 404, "HANDOFF_DISABLED");
      }
      const handoffId = request.params.handoffId;
      const accessToken = handoffBearer(request);
      if (typeof handoffId !== "string" || !accessToken) {
        return sendProblem(response, 401, "HANDOFF_UNAUTHORIZED");
      }
      if (
        !(await consumeStateRateLimit(
          request,
          response,
          "handoff-cancel",
          undefined,
        ))
      ) {
        return response;
      }
      const cancelled = await options.handoffService.cancel(
        handoffId,
        accessToken,
      );
      if (!cancelled) return sendProblem(response, 404, "HANDOFF_NOT_FOUND");
      return response.status(204).end();
    },
  );

  router.post(
    "/v1/results/:resultId/consume",
    async (request: Request, response: Response) => {
      response.set("cache-control", "no-store, private");
      response.vary("authorization");
      if (!options.resultReplayStore) {
        return sendProblem(response, 404, "STATE_ENDPOINT_DISABLED");
      }
      const parsedResultId = StateResourceIdSchema.safeParse(
        request.params.resultId,
      );
      const parsed = ResultConsumeSchema.safeParse(request.body);
      if (
        !parsedResultId.success ||
        !parsed.success ||
        !boundedFutureExpiry(parsed.data.expiresAt, maximumStateTtlSeconds)
      ) {
        return sendProblem(response, 400, "INVALID_RESULT_CONSUMPTION");
      }
      const resultId = parsedResultId.data;
      try {
        if (!(await consumeStateAuthenticationRateLimit(request, response))) {
          return response;
        }
        const principal = await authenticateStateRequest(request);
        if (
          !(await consumeStateRateLimit(
            request,
            response,
            "result-consume",
            principal,
          ))
        ) {
          return response;
        }
        const tenantId =
          principal === undefined
            ? "dev-local-unauthenticated"
            : tenantStateId(principal);
        const scopedResultId = scopedStateId(tenantId, resultId);
        const consumed = isLegacyAwareResultReplayStore(
          options.resultReplayStore,
        )
          ? await options.resultReplayStore.consumeWithLegacy(
              scopedResultId,
              resultId,
              parsed.data.expiresAt,
            )
          : await options.resultReplayStore.consume(
              scopedResultId,
              parsed.data.expiresAt,
            );
        return response.json({ consumed });
      } catch (error) {
        observeInternal(
          options.onInternalError,
          "RESULT_CONSUMPTION_REJECTED",
          401,
          error,
        );
        return sendProblem(response, 401, "RESULT_CONSUMPTION_REJECTED");
      }
    },
  );

  router.post(
    "/v1/results/:resultId/acceptances",
    async (request: Request, response: Response) => {
      response.set("cache-control", "no-store, private");
      response.vary("authorization");
      if (!options.resultAcceptanceStore) {
        return sendProblem(response, 404, "STATE_ENDPOINT_DISABLED");
      }
      const parsedResultId = StateResourceIdSchema.safeParse(
        request.params.resultId,
      );
      const parsed = ResultAcceptanceSchema.safeParse(request.body);
      if (
        !parsedResultId.success ||
        !parsed.success ||
        !boundedFutureExpiry(parsed.data.expiresAt, maximumStateTtlSeconds)
      ) {
        return sendProblem(response, 400, "INVALID_RESULT_ACCEPTANCE");
      }
      const resultId = parsedResultId.data;
      try {
        if (!(await consumeStateAuthenticationRateLimit(request, response))) {
          return response;
        }
        const principal = await authenticateStateRequest(request);
        if (
          !(await consumeStateRateLimit(
            request,
            response,
            "result-accept",
            principal,
          ))
        ) {
          return response;
        }
        const tenantId =
          principal === undefined
            ? "dev-local-unauthenticated"
            : tenantStateId(principal);
        const input = {
          resultId: scopedStateId(tenantId, resultId),
          operationId: parsed.data.operationId,
          requestDigest: parsed.data.requestDigest,
          expiresAt: parsed.data.expiresAt,
        };
        const status = isLegacyAwareResultAcceptanceStore(
          options.resultAcceptanceStore,
        )
          ? await options.resultAcceptanceStore.acceptWithLegacy(
              input,
              resultId,
            )
          : await options.resultAcceptanceStore.accept(input);
        return response.json({ status });
      } catch (error) {
        observeInternal(
          options.onInternalError,
          "RESULT_ACCEPTANCE_REJECTED",
          401,
          error,
        );
        return sendProblem(response, 401, "RESULT_ACCEPTANCE_REJECTED");
      }
    },
  );

  router.post(
    "/v1/requirements/:dependencyId/verify",
    async (request: Request, response: Response) => {
      if (options.rateLimiter) {
        const limit = await options.rateLimiter.consume(
          `verify:ip:${networkStateId(request)}`,
        );
        response.setHeader("x-ratelimit-remaining", String(limit.remaining));
        if (!limit.allowed) {
          response.setHeader("retry-after", "1");
          return sendProblem(response, 429, "RATE_LIMITED");
        }
      }
      const dependencyId = request.params.dependencyId;
      if (typeof dependencyId !== "string") {
        return sendProblem(response, 400, "INVALID_DEPENDENCY");
      }
      const requirement = await requirementStore.get(dependencyId);
      if (!requirement) {
        return sendProblem(response, 404, "DEPENDENCY_NOT_FOUND");
      }
      const parsed = ProofSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendProblem(response, 400, "INVALID_PROOF");
      }
      try {
        const proof = parseHumanProofSubmission(parsed.data);
        const satisfied = await options.service.satisfy({ requirement, proof });
        // Retain the requirement until the authenticated resource server has
        // evaluated the signed result. The dependency nonce was consumed by
        // satisfy(), so retaining policy state cannot re-run provider proof.
        // Reads delete it after acceptance; mutations keep it through TTL so
        // the same idempotent operation can cross x402 and retry safely.
        response.set(HUMAN_RESULT_HEADER, satisfied.token);
        response.set("cache-control", "no-store, private");
        // Never return native proof material; token + public result only.
        return response.status(200).json({
          result: satisfied.result,
          token: satisfied.token,
        });
      } catch (error) {
        await requirementStore.delete(requirement.dependencyId);
        const classified = classifyVerifierError(error);
        observeInternal(
          options.onInternalError,
          classified.code,
          classified.status,
          error,
        );
        return sendProblem(response, classified.status, classified.code);
      }
    },
  );

  router.get("/healthz", (_request, response) =>
    response.json({
      status: "ok",
      protocol: "x424",
      version: "0.1",
      profile,
    }),
  );

  router.get("/readyz", async (_request, response) => {
    try {
      await options.readinessCheck?.();
    } catch (error) {
      observeInternal(options.onInternalError, "NOT_READY", 503, error);
      return sendProblem(response, 503, "NOT_READY");
    }
    return response.json({
      status: "ready",
      protocol: "x424",
      version: "0.1",
      profile,
    });
  });

  return router;
}
