import { describe, expect, it } from "vitest";
import {
  InMemoryRequirementStore,
  InMemoryResultReplayStore,
  defineHumanMethodDescriptor,
  defineMethodCatalog,
  generateResultKeyPair,
  signHumanResult,
  type HumanResult,
} from "../src/core.js";
import { protectFetchResource } from "../src/middleware/resource.js";

const catalog = defineMethodCatalog([
  defineHumanMethodDescriptor({
    providerId: "example",
    methodId: "unique-human",
    version: "1",
    status: "enabled",
    claim: "example claim",
    nonClaims: ["Authorization"],
    assuranceLevels: ["example"],
    nativeScopeKinds: ["relying_party"],
    verificationModes: ["backend"],
    pairwisePseudonym: true,
    replaySemantics: "single-use",
    recoverySemantics: "provider-defined",
    privacy: "pairwise",
  }),
]);

describe("fetch resource middleware", () => {
  it("requires Idempotency-Key on mutations", async () => {
    const keys = generateResultKeyPair();
    const store = new InMemoryRequirementStore();
    const result = await protectFetchResource(
      new Request("https://api.example.test/records", { method: "POST" }),
      {
        purpose: "publish-record",
        audience: "https://api.example.test",
        accepts: [
          {
            providerId: "example",
            methodId: "unique-human",
            descriptorVersion: "1",
            acceptedScopeKinds: ["relying_party"],
          },
        ],
        catalog,
        verifier: keys.verifier,
        requirementStore: store,
        extractBinding: async () => ({
          kind: "session",
          value: "sha256:session",
        }),
      },
    );
    expect(result.response?.status).toBe(400);
  });

  it("challenges then accepts a bound result token", async () => {
    const keys = generateResultKeyPair();
    const store = new InMemoryRequirementStore();
    const replay = new InMemoryResultReplayStore();
    const options = {
      purpose: "publish-record",
      audience: "https://api.example.test",
      accepts: [
        {
          providerId: "example",
          methodId: "unique-human",
          descriptorVersion: "1",
          acceptedScopeKinds: ["relying_party" as const],
          assuranceLevel: "example",
          verificationModes: ["backend" as const],
        },
      ],
      catalog,
      verifier: keys.verifier,
      requirementStore: store,
      replayStore: replay,
      requireIdempotencyKey: false,
      extractBinding: async () => ({
        kind: "session" as const,
        value: "sha256:session",
      }),
    };

    const challenge = await protectFetchResource(
      new Request("https://api.example.test/records", { method: "POST" }),
      options,
    );
    expect(challenge.response?.status).toBe(424);
    const requirement = challenge.requirement!;

    const humanResult: HumanResult = {
      x424Version: "0.1",
      resultId: "x424_result_mw",
      dependencyId: requirement.dependencyId,
      satisfied: true,
      purpose: requirement.purpose,
      audience: requirement.resource.audience,
      requestDigest: requirement.resource.requestDigest,
      binding: requirement.binding,
      providerId: "example",
      methodId: "unique-human",
      descriptorVersion: "1",
      assuranceLevel: "example",
      pairwiseHumanId: "x424_human_mw",
      uniquenessScope: { kind: "relying_party", id: "example:rp" },
      verificationMode: "backend",
      proofDigest: "sha256:proof",
      claim: "example claim",
      nonClaims: ["Authorization"],
      verifiedAt: requirement.createdAt,
      issuedAt: requirement.createdAt,
      expiresAt: requirement.expiresAt,
    };
    const token = signHumanResult(humanResult, keys.signer);
    const accepted = await protectFetchResource(
      new Request("https://api.example.test/records", {
        method: "POST",
        headers: { "human-proof": token },
      }),
      options,
    );
    expect(accepted.result?.resultId).toBe("x424_result_mw");
    expect(accepted.response).toBeUndefined();
  });
});
