import { describe, expect, it } from "vitest";
import {
  InMemoryRequirementStore,
  InMemoryResultAcceptanceStore,
  InMemoryResultReplayStore,
  defineHumanMethodDescriptor,
  defineMethodCatalog,
  generateResultKeyPair,
  sha256,
  signHumanResult,
  type HumanResult,
} from "../src/core.js";
import {
  assertProtectOptions,
  protectFetchResource,
} from "../src/middleware/resource.js";

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

const publicOrigin = { publicOrigin: "https://api.example.test" };

function baseOptions(overrides: Record<string, unknown> = {}) {
  const keys = generateResultKeyPair();
  return {
    keys,
    options: {
      deploymentProfile: "dev-local-0.1" as const,
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
      requirementStore: new InMemoryRequirementStore(),
      replayStore: new InMemoryResultReplayStore(),
      resultAcceptanceStore: new InMemoryResultAcceptanceStore(),
      publicOrigin,
      requireIdempotencyKey: false,
      extractBinding: async () => ({
        kind: "session" as const,
        value: "sha256:session",
      }),
      ...overrides,
    },
  };
}

describe("fetch resource middleware", () => {
  it("requires Idempotency-Key on mutations", async () => {
    const { options } = baseOptions({ requireIdempotencyKey: true });
    const result = await protectFetchResource(
      new Request("https://api.example.test/records", { method: "POST" }),
      options,
    );
    expect(result.response?.status).toBe(400);
  });

  it("rejects configuration without replay store on eval/prod", () => {
    expect(() =>
      assertProtectOptions({
        deploymentProfile: "eval-redis-0.2",
        purpose: "publish-record",
        audience: "https://api.example.test",
        accepts: [],
        catalog,
        verifier: generateResultKeyPair().verifier,
        requirementStore: new InMemoryRequirementStore(),
        publicOrigin,
        extractBinding: async () => ({ kind: "session", value: "x" }),
      }),
    ).toThrow(/ResultReplayStore/);
  });

  it("rejects process-local stores outside dev-local", () => {
    const { options } = baseOptions({ deploymentProfile: "eval-redis-0.2" });
    expect(() => assertProtectOptions(options)).toThrow(
      /InMemoryRequirementStore/,
    );
  });

  it("requires an HTTPS public origin outside dev-local", () => {
    const { options } = baseOptions({
      deploymentProfile: "eval-redis-0.2",
      publicOrigin: { publicOrigin: "http://api.example.test" },
    });
    expect(() => assertProtectOptions(options)).toThrow(/HTTPS/);
  });

  it("challenges then accepts a bound result token", async () => {
    const { keys, options } = baseOptions();
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
      proofDigest: sha256("proof"),
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

  it("rejects URI, method, body, and binding substitution", async () => {
    const { keys, options } = baseOptions();
    const challenge = await protectFetchResource(
      new Request("https://api.example.test/a", {
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
      {
        ...options,
        body: { title: "A" },
        bodyInput: { kind: "json", value: { title: "A" } },
      },
    );
    const requirement = challenge.requirement!;
    const humanResult: HumanResult = {
      x424Version: "0.1",
      resultId: "x424_result_sub",
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
      pairwiseHumanId: "x424_human_sub",
      uniquenessScope: { kind: "relying_party", id: "example:rp" },
      verificationMode: "backend",
      proofDigest: sha256("proof"),
      claim: "example claim",
      nonClaims: ["Authorization"],
      verifiedAt: requirement.createdAt,
      issuedAt: requirement.createdAt,
      expiresAt: requirement.expiresAt,
    };
    const token = signHumanResult(humanResult, keys.signer);

    const wrongUri = await protectFetchResource(
      new Request("https://api.example.test/b", {
        method: "POST",
        headers: { "human-proof": token },
      }),
      { ...options, bodyInput: { kind: "json", value: { title: "A" } } },
    );
    expect(wrongUri.response?.status).toBe(401);

    // Fresh challenge for method substitution
    const challenge2 = await protectFetchResource(
      new Request("https://api.example.test/a", { method: "POST" }),
      { ...options, bodyInput: { kind: "json", value: { title: "A" } } },
    );
    const req2 = challenge2.requirement!;
    const token2 = signHumanResult(
      {
        ...humanResult,
        resultId: "r2",
        dependencyId: req2.dependencyId,
        requestDigest: req2.resource.requestDigest,
      },
      keys.signer,
    );
    const wrongMethod = await protectFetchResource(
      new Request("https://api.example.test/a", {
        method: "DELETE",
        headers: { "human-proof": token2 },
      }),
      { ...options, bodyInput: { kind: "json", value: { title: "A" } } },
    );
    expect(wrongMethod.response?.status).toBe(401);

    const challenge3 = await protectFetchResource(
      new Request("https://api.example.test/a", { method: "POST" }),
      { ...options, bodyInput: { kind: "json", value: { title: "A" } } },
    );
    const req3 = challenge3.requirement!;
    const token3 = signHumanResult(
      {
        ...humanResult,
        resultId: "r3",
        dependencyId: req3.dependencyId,
        requestDigest: req3.resource.requestDigest,
      },
      keys.signer,
    );
    const wrongBody = await protectFetchResource(
      new Request("https://api.example.test/a", {
        method: "POST",
        headers: { "human-proof": token3 },
      }),
      { ...options, bodyInput: { kind: "json", value: { title: "B" } } },
    );
    expect(wrongBody.response?.status).toBe(401);

    const challenge4 = await protectFetchResource(
      new Request("https://api.example.test/a", { method: "POST" }),
      { ...options, bodyInput: { kind: "json", value: { title: "A" } } },
    );
    const req4 = challenge4.requirement!;
    const token4 = signHumanResult(
      {
        ...humanResult,
        resultId: "r4",
        dependencyId: req4.dependencyId,
        requestDigest: req4.resource.requestDigest,
        binding: req4.binding,
      },
      keys.signer,
    );
    const wrongBinding = await protectFetchResource(
      new Request("https://api.example.test/a", {
        method: "POST",
        headers: { "human-proof": token4 },
      }),
      {
        ...options,
        bodyInput: { kind: "json", value: { title: "A" } },
        extractBinding: async () => ({
          kind: "session",
          value: "sha256:other-session",
        }),
      },
    );
    expect(wrongBinding.response?.status).toBe(401);
  });

  it("allows only one concurrent acceptance of the same result", async () => {
    const { keys, options } = baseOptions();
    const challenge = await protectFetchResource(
      new Request("https://api.example.test/records", { method: "POST" }),
      options,
    );
    const requirement = challenge.requirement!;
    const humanResult: HumanResult = {
      x424Version: "0.1",
      resultId: "x424_result_race",
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
      pairwiseHumanId: "x424_human_race",
      uniquenessScope: { kind: "relying_party", id: "example:rp" },
      verificationMode: "backend",
      proofDigest: sha256("proof"),
      claim: "example claim",
      nonClaims: ["Authorization"],
      verifiedAt: requirement.createdAt,
      issuedAt: requirement.createdAt,
      expiresAt: requirement.expiresAt,
    };
    const token = signHumanResult(humanResult, keys.signer);
    const request = new Request("https://api.example.test/records", {
      method: "POST",
      headers: { "human-proof": token },
    });
    const [a, b] = await Promise.all([
      protectFetchResource(request, options),
      protectFetchResource(request.clone(), options),
    ]);
    const successes = [a, b].filter((item) => item.result).length;
    const failures = [a, b].filter(
      (item) => item.response?.status === 401,
    ).length;
    expect(successes).toBe(1);
    expect(failures).toBe(1);
  });
});
