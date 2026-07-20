import { z } from "zod";
import { HUMAN_METHOD_IDENTIFIER_PATTERN } from "./catalog.js";
import type {
  HumanProofSubmission,
  HumanRequirement,
  HumanResult,
} from "./types.js";

const TimestampSchema = z.string().datetime({ offset: true });
const BindingSchema = z
  .object({
    kind: z.enum(["request", "wallet", "agent_key", "session"]),
    value: z.string().min(1).max(512),
  })
  .strict();
const MethodRequirementSchema = z
  .object({
    providerId: z.string().regex(HUMAN_METHOD_IDENTIFIER_PATTERN),
    methodId: z.string().regex(HUMAN_METHOD_IDENTIFIER_PATTERN),
    descriptorVersion: z.string().min(1).max(50),
    assuranceLevel: z.string().min(1).max(100).optional(),
    acceptedScopeKinds: z
      .array(z.enum(["global", "relying_party", "action", "session"]))
      .min(1)
      .max(4),
    maximumProofAgeSeconds: z.number().int().positive().max(86_400).optional(),
    verificationModes: z
      .array(z.enum(["backend", "offchain", "onchain", "hybrid"]))
      .min(1)
      .max(4)
      .optional(),
  })
  .strict();

export const HumanRequirementSchema = z
  .object({
    x424Version: z.literal("0.1"),
    dependencyId: z.string().min(1).max(200),
    purpose: z.string().min(1).max(200),
    resource: z
      .object({
        method: z.string().min(1).max(20),
        uri: z.string().url().max(2_048),
        audience: z.string().url().max(2_048),
        requestDigest: z.string().startsWith("sha256:").max(200),
      })
      .strict(),
    nonce: z.string().min(1).max(512),
    binding: BindingSchema,
    createdAt: TimestampSchema,
    expiresAt: TimestampSchema,
    accepts: z.array(MethodRequirementSchema).min(1).max(10),
    providerRequests: z.record(z.string().max(201), z.unknown()).optional(),
  })
  .strict();

export const HumanProofSubmissionSchema = z
  .object({
    x424Version: z.literal("0.1"),
    dependencyId: z.string().min(1).max(200),
    providerId: z.string().regex(HUMAN_METHOD_IDENTIFIER_PATTERN),
    methodId: z.string().regex(HUMAN_METHOD_IDENTIFIER_PATTERN),
    binding: BindingSchema,
    nativeProof: z.unknown(),
  })
  .strict();

export const HumanResultSchema = z
  .object({
    x424Version: z.literal("0.1"),
    resultId: z.string().min(1).max(200),
    dependencyId: z.string().min(1).max(200),
    satisfied: z.literal(true),
    purpose: z.string().min(1).max(200),
    audience: z.string().url().max(2_048),
    requestDigest: z.string().startsWith("sha256:").max(200),
    binding: BindingSchema,
    providerId: z.string().regex(HUMAN_METHOD_IDENTIFIER_PATTERN),
    methodId: z.string().regex(HUMAN_METHOD_IDENTIFIER_PATTERN),
    descriptorVersion: z.string().min(1).max(50),
    assuranceLevel: z.string().min(1).max(100).optional(),
    pairwiseHumanId: z.string().startsWith("x424_human_").max(200),
    uniquenessScope: z
      .object({
        kind: z.enum(["global", "relying_party", "action", "session"]),
        id: z.string().min(1).max(500),
      })
      .strict(),
    verificationMode: z.enum(["backend", "offchain", "onchain", "hybrid"]),
    proofDigest: z.string().startsWith("sha256:").max(200),
    claim: z.string().min(1).max(2_000),
    nonClaims: z.array(z.string().min(1).max(1_000)).min(1).max(50),
    verifiedAt: TimestampSchema,
    issuedAt: TimestampSchema,
    expiresAt: TimestampSchema,
    stateReferences: z.array(z.string().min(1).max(500)).max(20).optional(),
  })
  .strict();

export function parseHumanRequirement(value: unknown): HumanRequirement {
  return HumanRequirementSchema.parse(value) as HumanRequirement;
}

export function parseHumanProofSubmission(
  value: unknown,
): HumanProofSubmission {
  return HumanProofSubmissionSchema.parse(value) as HumanProofSubmission;
}

export function parseHumanResult(value: unknown): HumanResult {
  return HumanResultSchema.parse(value) as HumanResult;
}
