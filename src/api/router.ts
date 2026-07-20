import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  assertIssuanceRouterConfig,
  authorizeIssuance,
  IssuanceAuthorizationError,
  type DeploymentProfile,
  type IssuanceAuthenticator,
} from "../auth/issuance.js";
import { HUMAN_METHOD_IDENTIFIER_PATTERN } from "../catalog.js";
import {
  bodyInputFromPlainJsonBody,
  type RequestBodyDigestInput,
} from "../canonical.js";
import { decodeStrictBase64Url } from "../encoding.js";
import { HUMAN_RESULT_HEADER, humanRequiredResponse } from "../http.js";
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
  RequirementStore,
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

export interface X424HttpRouterOptions {
  readonly service: X424Service;
  readonly providerRequests: (input: {
    readonly purpose: string;
    readonly binding: HumanBinding;
    readonly accepts: readonly HumanMethodRequirement[];
    readonly ttlSeconds: number;
  }) => Promise<Readonly<Record<string, unknown>>>;
  readonly requirementStore?: RequirementStore;
  readonly maximumPendingRequirements?: number;
  readonly issuanceAuthenticator?: IssuanceAuthenticator;
  readonly allowUnauthenticatedIssuance?: boolean;
  readonly rateLimiter?: {
    consume(key: string): {
      allowed: boolean;
      remaining: number;
      resetAt: number;
    };
  };
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

/**
 * Reference API router. Construction fails closed for misconfigured profiles.
 */
export function createX424HttpRouter(options: X424HttpRouterOptions): Router {
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

  router.post(
    "/v1/requirements",
    async (request: Request, response: Response) => {
      if (options.rateLimiter) {
        const key = request.ip ?? "unknown";
        const limit = options.rateLimiter.consume(`issue:${key}`);
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
        if (options.issuanceAuthenticator) {
          const principal = await options.issuanceAuthenticator.authenticate({
            authorizationHeader: request.get("authorization") ?? null,
          });
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
        }
        const accepts = exactMethods(parsed.data.accepts);
        const providerRequests = await options.providerRequests({
          purpose: parsed.data.purpose,
          binding: parsed.data.binding,
          accepts,
          ttlSeconds: parsed.data.ttlSeconds,
        });
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
        await requirementStore.put(requirement);
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

  router.post(
    "/v1/requirements/:dependencyId/verify",
    async (request: Request, response: Response) => {
      if (options.rateLimiter) {
        const key = request.ip ?? "unknown";
        const limit = options.rateLimiter.consume(`verify:${key}`);
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
        await requirementStore.delete(requirement.dependencyId);
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
