import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { HUMAN_METHOD_IDENTIFIER_PATTERN } from "../catalog.js";
import {
  HUMAN_REQUIRED_HEADER,
  HUMAN_RESULT_HEADER,
  encodeHumanRequirement,
} from "../http.js";
import { createHumanRequirement } from "../requirements.js";
import { InMemoryRequirementStore } from "../requirement-store.js";
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

const CreateSchema = z
  .object({
    purpose: z.string().min(1).max(200),
    method: z.string().min(1).max(20),
    uri: z.string().url().max(2_048),
    audience: z.string().url().max(2_048),
    body: z.unknown().optional(),
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
  /** Builds provider-native signed request material on the trusted backend. */
  readonly providerRequests: (input: {
    readonly purpose: string;
    readonly binding: HumanBinding;
    readonly accepts: readonly HumanMethodRequirement[];
    readonly ttlSeconds: number;
  }) => Promise<Readonly<Record<string, unknown>>>;
  /** Shared pending state. Omit only for local development and tests. */
  readonly requirementStore?: RequirementStore;
  readonly maximumPendingRequirements?: number;
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

function problem(
  response: Response,
  status: number,
  code: string,
  detail: string,
) {
  return response
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
 * Reference API router. Deployments must add authentication, authorization,
 * rate limits, a distributed requirement store, and durable atomic nonces.
 */
export function createX424HttpRouter(options: X424HttpRouterOptions): Router {
  const router = Router();
  const requirementStore =
    options.requirementStore ??
    new InMemoryRequirementStore(options.maximumPendingRequirements ?? 10_000);

  router.post(
    "/v1/requirements",
    async (request: Request, response: Response) => {
      const parsed = CreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return problem(
          response,
          400,
          "INVALID_REQUIREMENT",
          "Request body is invalid",
        );
      }
      try {
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
          ...(parsed.data.body === undefined ? {} : { body: parsed.data.body }),
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
        response.set(
          HUMAN_REQUIRED_HEADER,
          encodeHumanRequirement(requirement),
        );
        response.set("cache-control", "no-store, private");
        return response.status(201).json({ requirement });
      } catch (error) {
        return problem(
          response,
          400,
          "REQUIREMENT_REJECTED",
          error instanceof Error ? error.message : "Requirement rejected",
        );
      }
    },
  );

  router.post(
    "/v1/requirements/:dependencyId/verify",
    async (request: Request, response: Response) => {
      const dependencyId = request.params.dependencyId;
      if (typeof dependencyId !== "string") {
        return problem(
          response,
          400,
          "INVALID_DEPENDENCY",
          "Invalid dependency ID",
        );
      }
      const requirement = await requirementStore.get(dependencyId);
      if (!requirement) {
        return problem(
          response,
          404,
          "DEPENDENCY_NOT_FOUND",
          "Unknown dependency",
        );
      }
      const parsed = ProofSchema.safeParse(request.body);
      if (!parsed.success) {
        return problem(response, 400, "INVALID_PROOF", "Proof body is invalid");
      }
      try {
        const proof = parseHumanProofSubmission(parsed.data);
        const satisfied = await options.service.satisfy({ requirement, proof });
        await requirementStore.delete(requirement.dependencyId);
        response.set(HUMAN_RESULT_HEADER, satisfied.token);
        response.set("cache-control", "no-store, private");
        return response.status(200).json(satisfied);
      } catch (error) {
        await requirementStore.delete(requirement.dependencyId);
        return problem(
          response,
          422,
          "PROOF_REJECTED",
          error instanceof Error ? error.message : "Proof rejected",
        );
      }
    },
  );

  router.get("/healthz", (_request, response) =>
    response.json({ status: "ok", protocol: "x424", version: "0.1" }),
  );

  return router;
}
