import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { HUMAN_METHOD_IDENTIFIER_PATTERN } from "../catalog.js";
import {
  createHumanRequirement,
  decodeHumanRequirement,
  decodeHumanResult,
  defineHumanMethodDescriptor,
  defineMethodCatalog,
  encodeHumanRequirement,
  encodeHumanResult,
  evaluateHumanResult,
  sha256,
  verifyHumanResultToken,
} from "../index.js";
import type { HumanMethodDescriptor, HumanResult } from "../types.js";

const HeaderSchema = z.string().min(1).max(65_536);
const BindingSchema = z
  .object({
    kind: z.enum(["request", "wallet", "agent_key", "session"]),
    value: z.string().min(1).max(512),
  })
  .strict();
const AcceptedMethodSchema = z
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
const MethodDescriptorSchema = z
  .object({
    providerId: z.string().regex(HUMAN_METHOD_IDENTIFIER_PATTERN),
    methodId: z.string().regex(HUMAN_METHOD_IDENTIFIER_PATTERN),
    version: z.string().min(1).max(50),
    status: z.enum(["enabled", "disabled"]),
    claim: z.string().min(1).max(2_000),
    nonClaims: z.array(z.string().min(1).max(1_000)).min(1).max(50),
    assuranceLevels: z.array(z.string().min(1).max(100)).max(20),
    nativeScopeKinds: z
      .array(z.enum(["global", "relying_party", "action", "session"]))
      .min(1)
      .max(4),
    verificationModes: z
      .array(z.enum(["backend", "offchain", "onchain", "hybrid"]))
      .min(1)
      .max(4),
    pairwisePseudonym: z.boolean(),
    replaySemantics: z.string().min(1).max(2_000),
    recoverySemantics: z.string().min(1).max(2_000),
    privacy: z.string().min(1).max(2_000),
  })
  .strict();

const CONFORMANCE_METHOD = defineHumanMethodDescriptor({
  providerId: "example",
  methodId: "unique-human",
  version: "1",
  status: "enabled",
  claim:
    "The example verifier accepted one unique human in the declared relying-party scope.",
  nonClaims: [
    "Legal identity",
    "Authorization for the protected action",
    "Equivalence to another provider method",
  ],
  assuranceLevels: ["example"],
  nativeScopeKinds: ["relying_party"],
  verificationModes: ["backend"],
  pairwisePseudonym: true,
  replaySemantics: "The example proof and x424 dependency are single-use.",
  recoverySemantics:
    "Recovery behavior is defined by the example provider, not x424.",
  privacy:
    "Provider subjects remain inside the verifier and are represented pairwise.",
});

const RequirementSummarySchema = z.object({
  version: z.string(),
  dependencyId: z.string(),
  purpose: z.string(),
  method: z.string(),
  uri: z.string(),
  audience: z.string(),
  requestDigest: z.string(),
  bindingKind: z.string(),
  acceptedMethods: z.array(z.string()),
  expiresAt: z.string(),
});

function summarizeRequirement(
  requirement: ReturnType<typeof decodeHumanRequirement>,
) {
  return {
    version: requirement.x424Version,
    dependencyId: requirement.dependencyId,
    purpose: requirement.purpose,
    method: requirement.resource.method,
    uri: requirement.resource.uri,
    audience: requirement.resource.audience,
    requestDigest: requirement.resource.requestDigest,
    bindingKind: requirement.binding.kind,
    acceptedMethods: requirement.accepts.map(
      ({ providerId, methodId, descriptorVersion }) =>
        `${providerId}:${methodId}@${descriptorVersion}`,
    ),
    expiresAt: requirement.expiresAt,
  };
}

function ok(structuredContent: Record<string, unknown>) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
  };
}

function toolError(_error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: "x424 rejected the input. Inspect the dependency and use the exact provider, method, audience, request, and caller binding.",
      },
    ],
  };
}

export function createX424McpServer(): McpServer {
  const server = new McpServer({ name: "x424-mcp-server", version: "0.1.2" });

  server.registerTool(
    "x424_inspect_requirement",
    {
      title: "Inspect an x424 human dependency",
      description:
        "Decode a HUMAN-REQUIRED header and return the exact protected request, caller binding type, expiry, and accepted provider methods. This tool does not verify or satisfy the dependency.",
      inputSchema: z.object({ human_required: HeaderSchema }).strict(),
      outputSchema: RequirementSummarySchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ human_required }) => {
      try {
        return ok(summarizeRequirement(decodeHumanRequirement(human_required)));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "x424_create_requirement",
    {
      title: "Create an x424 human dependency",
      description:
        "Create a short-lived HUMAN-REQUIRED header for one HTTP request. Every accepted provider/method must be listed explicitly; this does not register the nonce in a production store or verify a human.",
      inputSchema: z
        .object({
          purpose: z.string().min(1).max(200),
          method: z.string().min(1).max(20),
          uri: z.string().url().max(2_048),
          audience: z.string().url().max(2_048),
          body: z.unknown().optional(),
          binding: BindingSchema,
          accepts: z.array(AcceptedMethodSchema).min(1).max(10),
          ttl_seconds: z.number().int().min(30).max(900).default(300),
        })
        .strict(),
      outputSchema: z.object({
        humanRequired: z.string(),
        dependencyId: z.string(),
        requestDigest: z.string(),
        expiresAt: z.string(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({
      purpose,
      method,
      uri,
      audience,
      body,
      binding,
      accepts,
      ttl_seconds,
    }) => {
      try {
        const requirement = createHumanRequirement({
          purpose,
          method,
          uri,
          audience,
          ...(body === undefined ? {} : { body }),
          binding,
          accepts: accepts.map((accepted) => ({
            providerId: accepted.providerId,
            methodId: accepted.methodId,
            descriptorVersion: accepted.descriptorVersion,
            acceptedScopeKinds: accepted.acceptedScopeKinds,
            ...(accepted.assuranceLevel === undefined
              ? {}
              : { assuranceLevel: accepted.assuranceLevel }),
            ...(accepted.maximumProofAgeSeconds === undefined
              ? {}
              : { maximumProofAgeSeconds: accepted.maximumProofAgeSeconds }),
            ...(accepted.verificationModes === undefined
              ? {}
              : { verificationModes: accepted.verificationModes }),
          })),
          ttlSeconds: ttl_seconds,
        });
        const { encodeHumanRequirement } = await import("../http.js");
        return ok({
          humanRequired: encodeHumanRequirement(requirement),
          dependencyId: requirement.dependencyId,
          requestDigest: requirement.resource.requestDigest,
          expiresAt: requirement.expiresAt,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "x424_evaluate_result",
    {
      title: "Evaluate an x424 result against a dependency",
      description:
        "Fail-closed comparison of a decoded HUMAN-RESULT payload with its HUMAN-REQUIRED header and the relying party's exact immutable method descriptors. It checks provider/method, descriptor version, uniqueness scope, verification mode, audience, request digest, caller binding, freshness, and expiry. It does not verify a token signature; use x424_verify_result_token first for signed results.",
      inputSchema: z
        .object({
          human_required: HeaderSchema,
          human_result: HeaderSchema,
          method_descriptors: z.array(MethodDescriptorSchema).min(1).max(20),
          now: z.string().datetime().optional(),
        })
        .strict(),
      outputSchema: z.object({
        satisfied: z.boolean(),
        failureCodes: z.array(z.string()),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ human_required, human_result, method_descriptors, now }) => {
      try {
        const evaluation = evaluateHumanResult({
          requirement: decodeHumanRequirement(human_required),
          result: decodeHumanResult(human_result),
          catalog: defineMethodCatalog(
            method_descriptors.map((descriptor) =>
              defineHumanMethodDescriptor(descriptor as HumanMethodDescriptor),
            ),
          ),
          ...(now ? { now: new Date(now) } : {}),
        });
        return ok({
          satisfied: evaluation.satisfied,
          failureCodes: evaluation.failures.map(({ code }) => code),
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "x424_verify_result_token",
    {
      title: "Verify a signed x424 result token",
      description:
        "Verify the Ed25519 signature on an x424-result+jws token with the relying party's trusted PEM public key, then return only its dependency, provider/method, pairwise human, binding type, audience, and expiry. Signature validity is not application authorization.",
      inputSchema: z
        .object({
          token: z.string().min(1).max(65_536),
          key_id: z.string().min(1).max(200),
          public_key_pem: z.string().min(1).max(16_384),
        })
        .strict(),
      outputSchema: z.object({
        valid: z.literal(true),
        dependencyId: z.string(),
        providerMethod: z.string(),
        pairwiseHumanId: z.string(),
        bindingKind: z.string(),
        audience: z.string(),
        expiresAt: z.string(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ token, key_id, public_key_pem }) => {
      try {
        const result = verifyHumanResultToken(token, {
          keyId: key_id,
          publicKey: public_key_pem,
        });
        return ok({
          valid: true,
          dependencyId: result.dependencyId,
          providerMethod: `${result.providerId}:${result.methodId}@${result.descriptorVersion}`,
          pairwiseHumanId: result.pairwiseHumanId,
          bindingKind: result.binding.kind,
          audience: result.audience,
          expiresAt: result.expiresAt,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerResource(
    "x424-protocol-profile",
    "x424://protocol/profile/0.1",
    {
      title: "x424 protocol profile 0.1",
      description:
        "Stable machine-readable statement of x424's scope and non-claims.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              version: "0.1",
              dependency: "unique_human",
              status: 424,
              headers: ["HUMAN-REQUIRED", "HUMAN-PROOF", "HUMAN-RESULT"],
              providerPolicy: "explicit_relying_party_allowlist",
              nonClaims: [
                "identity wallet",
                "generic credential protocol",
                "agent authorization",
                "provider equivalence",
                "payment",
              ],
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerResource(
    "x424-conformance-fixtures",
    "x424://fixtures/conformance/0.1",
    {
      title: "x424 conformance fixtures 0.1",
      description:
        "Fixed positive and negative headers for deterministic read-only MCP evaluation.",
      mimeType: "application/json",
    },
    async (uri) => {
      const at = new Date("2026-07-19T12:00:00.000Z");
      const requirement = createHumanRequirement({
        purpose: "publish-record",
        method: "POST",
        uri: "https://api.example.test/records",
        audience: "https://api.example.test",
        body: { title: "Conformance fixture" },
        binding: { kind: "agent_key", value: "sha256:fixture-agent-key" },
        accepts: [
          {
            providerId: CONFORMANCE_METHOD.providerId,
            methodId: CONFORMANCE_METHOD.methodId,
            descriptorVersion: "1",
            assuranceLevel: "example",
            acceptedScopeKinds: ["relying_party"],
            maximumProofAgeSeconds: 300,
            verificationModes: ["backend"],
          },
        ],
        dependencyId: "x424_dep_fixture",
        nonce: "fixture-nonce",
        ttlSeconds: 300,
        now: at,
      });
      const result: HumanResult = {
        x424Version: "0.1",
        resultId: "x424_result_fixture",
        dependencyId: requirement.dependencyId,
        satisfied: true,
        purpose: requirement.purpose,
        audience: requirement.resource.audience,
        requestDigest: requirement.resource.requestDigest,
        binding: requirement.binding,
        providerId: CONFORMANCE_METHOD.providerId,
        methodId: CONFORMANCE_METHOD.methodId,
        descriptorVersion: "1",
        assuranceLevel: "example",
        pairwiseHumanId: "x424_human_fixture",
        uniquenessScope: {
          kind: "relying_party",
          id: "example:rp_fixture",
        },
        verificationMode: "backend",
        proofDigest: sha256("fixture-proof"),
        claim: CONFORMANCE_METHOD.claim,
        nonClaims: CONFORMANCE_METHOD.nonClaims,
        verifiedAt: "2026-07-19T11:59:30.000Z",
        issuedAt: at.toISOString(),
        expiresAt: "2026-07-19T12:05:00.000Z",
      };
      const providerSubstitution = {
        ...result,
        providerId: "other-provider",
        methodId: "unique-human",
      };
      const requestSubstitution = {
        ...result,
        requestDigest: sha256("wrong"),
      };
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                evaluationTime: at.toISOString(),
                expiredEvaluationTime: "2026-07-19T12:06:00.000Z",
                methodDescriptors: [CONFORMANCE_METHOD],
                humanRequired: encodeHumanRequirement(requirement),
                validHumanResult: encodeHumanResult(result),
                providerSubstitutionResult:
                  encodeHumanResult(providerSubstitution),
                requestSubstitutionResult:
                  encodeHumanResult(requestSubstitution),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  return server;
}
