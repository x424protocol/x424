import { describe, expect, it } from "vitest";
import {
  WORLD_ID_PROOF_OF_HUMAN_METHOD,
  WORLD_ID_LEGACY_ORB_METHOD,
  X424Service,
  createWorldIdMethodRequirements,
  createWorldIdProviderRequests,
  createHumanRequirement,
  decodeHumanRequirement,
  defineMethodCatalog,
  encodeHumanRequirement,
  evaluateHumanResult,
  generatePairwiseSecret,
  generateResultKeyPair,
  humanRequiredResponse,
  InMemoryNonceStore,
  InMemoryProviderReplayStore,
  InMemoryResultReplayStore,
  requestDigest,
  sha256,
  verifyHumanResultToken,
  verifyHumanProofHeader,
  WorldIdAdapter,
  worldIdProviderRequestFromRequirement,
  type HumanProofSubmission,
  type HumanResult,
} from "../src/index.js";

const now = new Date("2026-07-19T12:00:00.000Z");
const binding = { kind: "agent_key", value: "sha256:agent-key-1" } as const;
const signingKeyHex = `0x${"ab".repeat(32)}`;

function requirement(
  options: {
    allowLegacyProofs?: boolean;
    dependencyId?: string;
    nonce?: string;
  } = {},
) {
  const providerRequests = createWorldIdProviderRequests({
    appId: "app_test",
    rpId: "rp_test",
    action: "x424-test",
    environment: "staging",
    signingKeyHex,
    binding,
    ...(options.allowLegacyProofs === undefined
      ? {}
      : { allowLegacyProofs: options.allowLegacyProofs }),
  });
  return createHumanRequirement({
    purpose: "publish-market",
    method: "POST",
    uri: "https://api.example.test/markets",
    audience: "https://api.example.test",
    body: { question: "Will x424 ship?" },
    binding,
    accepts: createWorldIdMethodRequirements({
      ...(options.allowLegacyProofs === undefined
        ? {}
        : { allowLegacyProofs: options.allowLegacyProofs }),
      maximumProofAgeSeconds: 300,
    }),
    providerRequests,
    dependencyId: options.dependencyId ?? "x424_dep_test",
    nonce: options.nonce ?? "nonce-test",
    ttlSeconds: 300,
    now,
  });
}

function proof(required: ReturnType<typeof requirement>): HumanProofSubmission {
  const providerRequest = worldIdProviderRequestFromRequirement(required);
  return {
    x424Version: "0.1",
    dependencyId: required.dependencyId,
    providerId: "world",
    methodId: "proof-of-human",
    binding,
    nativeProof: {
      protocol_version: "4.0",
      nonce: providerRequest.rpContext.nonce,
      action: providerRequest.action,
      environment: providerRequest.environment,
      responses: [
        {
          identifier: "proof_of_human",
          signal_hash: providerRequest.signalHash,
          proof: ["opaque"],
          nullifier: "0xprivate-world-nullifier",
          issuer_schema_id: 1,
          expires_at_min: 1_800_000_000,
        },
      ],
    },
  };
}

function legacyProof(
  required: ReturnType<typeof requirement>,
): HumanProofSubmission {
  const providerRequest = worldIdProviderRequestFromRequirement(
    required,
    "orb-legacy",
  );
  return {
    x424Version: "0.1",
    dependencyId: required.dependencyId,
    providerId: "world",
    methodId: "orb-legacy",
    binding,
    nativeProof: {
      protocol_version: "3.0",
      nonce: providerRequest.rpContext.nonce,
      action: providerRequest.action,
      environment: providerRequest.environment,
      responses: [
        {
          identifier: "orb",
          signal_hash: providerRequest.signalHash,
          proof: "0xlegacy-proof",
          merkle_root: "0xlegacy-root",
          nullifier: "0xprivate-legacy-nullifier",
        },
      ],
    },
  };
}

describe("x424 wire contract", () => {
  it("round-trips base64url headers without changing the payload", () => {
    const required = requirement();
    expect(decodeHumanRequirement(encodeHumanRequirement(required))).toEqual(
      required,
    );
  });

  it("returns 424 and the three x424 transport controls", () => {
    const response = humanRequiredResponse(requirement());
    expect(response.status).toBe(424);
    expect(response.headers["human-required"]).toBeTruthy();
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers.vary).toBe("human-proof");
  });

  it("binds method, URI, and body into the request digest", () => {
    const a = requestDigest({ method: "POST", uri: "/x", body: { a: 1 } });
    const b = requestDigest({ method: "POST", uri: "/x", body: { a: 2 } });
    expect(a).not.toBe(b);
  });
});

describe("World ID reference adapter and result service", () => {
  it("keeps World-native proof and nullifier inside the adapter boundary", async () => {
    const seen: unknown[] = [];
    const adapter = new WorldIdAdapter({
      rpId: "rp_test",
      action: "x424-test",
      environment: "staging",
      verifyRemote: async (nativeProof) => {
        seen.push(nativeProof);
        return {
          success: true,
          action: "x424-test",
          environment: "staging",
          results: [
            {
              identifier: "proof_of_human",
              success: true,
              nullifier: "0xprivate-world-nullifier",
            },
          ],
          created_at: now.toISOString(),
        };
      },
      now: () => now,
    });
    const nonceStore = new InMemoryNonceStore();
    const keys = generateResultKeyPair();
    const service = new X424Service({
      catalog: defineMethodCatalog(adapter.methods()),
      adapters: [adapter],
      nonceStore,
      providerReplayStore: new InMemoryProviderReplayStore(),
      pairwiseSecret: generatePairwiseSecret(),
      resultSigner: keys.signer,
      now: () => now,
    });
    const required = requirement();
    await service.register(required);
    const satisfied = await service.satisfy({
      requirement: required,
      proof: proof(required),
    });

    expect(seen).toEqual([proof(required).nativeProof]);
    expect(JSON.stringify(satisfied.result)).not.toContain(
      "private-world-nullifier",
    );
    expect(satisfied.result.pairwiseHumanId).toMatch(/^x424_human_/);
    expect(satisfied.result.providerId).toBe("world");
    expect(satisfied.result.uniquenessScope.kind).toBe("action");
    expect(verifyHumanResultToken(satisfied.token, keys.verifier)).toEqual(
      satisfied.result,
    );
    const replayStore = new InMemoryResultReplayStore();
    await expect(
      verifyHumanProofHeader({
        humanProof: satisfied.token,
        requirement: required,
        verifier: keys.verifier,
        catalog: defineMethodCatalog(adapter.methods()),
        replayStore,
        now,
      }),
    ).resolves.toEqual(satisfied.result);
    await expect(
      verifyHumanProofHeader({
        humanProof: satisfied.token,
        requirement: required,
        verifier: keys.verifier,
        catalog: defineMethodCatalog(adapter.methods()),
        replayStore,
        now,
      }),
    ).rejects.toThrow("already consumed");
    await expect(
      service.satisfy({ requirement: required, proof: proof(required) }),
    ).rejects.toThrow("already used");
  });

  it("atomically rejects the same provider subject across dependencies", async () => {
    const adapter = new WorldIdAdapter({
      rpId: "rp_test",
      action: "x424-test",
      environment: "staging",
      verifyRemote: async () => ({
        success: true,
        action: "x424-test",
        environment: "staging",
        results: [
          {
            identifier: "proof_of_human",
            success: true,
            nullifier: "0xprivate-world-nullifier",
          },
        ],
        created_at: now.toISOString(),
      }),
      now: () => now,
    });
    const service = new X424Service({
      catalog: defineMethodCatalog(adapter.methods()),
      adapters: [adapter],
      nonceStore: new InMemoryNonceStore(),
      providerReplayStore: new InMemoryProviderReplayStore(),
      pairwiseSecret: generatePairwiseSecret(),
      resultSigner: generateResultKeyPair().signer,
      now: () => now,
    });
    const first = requirement({ dependencyId: "dep-first", nonce: "first" });
    const second = requirement({
      dependencyId: "dep-second",
      nonce: "second",
    });
    await service.register(first);
    await service.register(second);
    await expect(
      service.satisfy({ requirement: first, proof: proof(first) }),
    ).resolves.toHaveProperty("result.satisfied", true);

    await expect(
      service.satisfy({ requirement: second, proof: proof(second) }),
    ).rejects.toThrow("already consumed");
  });

  it("rejects a World proof whose signal is not the x424 caller binding", async () => {
    const adapter = new WorldIdAdapter({
      rpId: "rp_test",
      action: "x424-test",
      environment: "staging",
      verifyRemote: async () => {
        throw new Error("remote verifier must not be called");
      },
      now: () => now,
    });
    const required = requirement();
    const mismatched = proof(required);
    const nativeProof = mismatched.nativeProof as {
      responses: Array<Record<string, unknown>>;
    };
    nativeProof.responses[0] = {
      ...nativeProof.responses[0],
      signal_hash: "0xwrong",
    };
    const service = new X424Service({
      catalog: defineMethodCatalog(adapter.methods()),
      adapters: [adapter],
      nonceStore: new InMemoryNonceStore(),
      providerReplayStore: new InMemoryProviderReplayStore(),
      pairwiseSecret: generatePairwiseSecret(),
      resultSigner: generateResultKeyPair().signer,
      now: () => now,
    });
    await service.register(required);

    await expect(
      service.satisfy({ requirement: required, proof: mismatched }),
    ).rejects.toThrow("no valid Proof of Human response");
  });

  it("rejects a legacy credential mislabeled as the v4 method", async () => {
    const adapter = new WorldIdAdapter({
      rpId: "rp_test",
      action: "x424-test",
      environment: "staging",
      verifyRemote: async () => {
        throw new Error("remote verifier must not be called");
      },
      now: () => now,
    });
    const required = requirement({ allowLegacyProofs: true });
    const legacy = legacyProof(required);
    const mislabeled = { ...legacy, methodId: "proof-of-human" };
    const service = new X424Service({
      catalog: defineMethodCatalog(adapter.methods()),
      adapters: [adapter],
      nonceStore: new InMemoryNonceStore(),
      providerReplayStore: new InMemoryProviderReplayStore(),
      pairwiseSecret: generatePairwiseSecret(),
      resultSigner: generateResultKeyPair().signer,
      now: () => now,
    });
    await service.register(required);

    await expect(
      service.satisfy({ requirement: required, proof: mislabeled }),
    ).rejects.toThrow("configured World profile");
  });

  it("keeps the legacy fallback as a distinct signed method result", async () => {
    const adapter = new WorldIdAdapter({
      rpId: "rp_test",
      action: "x424-test",
      environment: "staging",
      allowLegacyProofs: true,
      verifyRemote: async () => ({
        success: true,
        action: "x424-test",
        environment: "staging",
        results: [
          {
            identifier: "orb",
            success: true,
            nullifier: "0xprivate-legacy-nullifier",
          },
        ],
        created_at: now.toISOString(),
      }),
      now: () => now,
    });
    const service = new X424Service({
      catalog: defineMethodCatalog(adapter.methods()),
      adapters: [adapter],
      nonceStore: new InMemoryNonceStore(),
      providerReplayStore: new InMemoryProviderReplayStore(),
      pairwiseSecret: generatePairwiseSecret(),
      resultSigner: generateResultKeyPair().signer,
      now: () => now,
    });
    const required = requirement({ allowLegacyProofs: true });
    await service.register(required);

    const { result } = await service.satisfy({
      requirement: required,
      proof: legacyProof(required),
    });

    expect(result.methodId).toBe("orb-legacy");
    expect(result.assuranceLevel).toBe("orb-legacy");
    expect(result.claim).toContain("World ID 3.0 Orb");
    expect(result.nonClaims).toContain(
      "Cross-version deduplication against a World ID 4 nullifier",
    );
    expect(JSON.stringify(result)).not.toContain("private-legacy-nullifier");
  });

  it("rejects a legacy proof without the signed caller signal", async () => {
    const adapter = new WorldIdAdapter({
      rpId: "rp_test",
      action: "x424-test",
      environment: "staging",
      allowLegacyProofs: true,
      verifyRemote: async () => {
        throw new Error("remote verifier must not be called");
      },
      now: () => now,
    });
    const required = requirement({ allowLegacyProofs: true });
    const unbound = legacyProof(required);
    const nativeProof = unbound.nativeProof as {
      responses: Array<Record<string, unknown>>;
    };
    delete nativeProof.responses[0]!.signal_hash;
    const service = new X424Service({
      catalog: defineMethodCatalog(adapter.methods()),
      adapters: [adapter],
      nonceStore: new InMemoryNonceStore(),
      providerReplayStore: new InMemoryProviderReplayStore(),
      pairwiseSecret: generatePairwiseSecret(),
      resultSigner: generateResultKeyPair().signer,
      now: () => now,
    });
    await service.register(required);

    await expect(
      service.satisfy({ requirement: required, proof: unbound }),
    ).rejects.toThrow("no valid legacy Orb response");
  });

  it("rejects provider substitution even when both claim unique humanity", () => {
    const required = requirement();
    const result: HumanResult = {
      x424Version: "0.1",
      resultId: "result-1",
      dependencyId: required.dependencyId,
      satisfied: true,
      purpose: required.purpose,
      audience: required.resource.audience,
      requestDigest: required.resource.requestDigest,
      binding: required.binding,
      providerId: "another-provider",
      methodId: "unique-human",
      descriptorVersion: "1",
      pairwiseHumanId: "pairwise",
      uniquenessScope: { kind: "action", id: "other" },
      verificationMode: "backend",
      proofDigest: sha256("proof"),
      claim: "Another provider says unique human",
      nonClaims: ["World ID Orb proof"],
      verifiedAt: now.toISOString(),
      issuedAt: now.toISOString(),
      expiresAt: "2026-07-19T12:05:00.000Z",
    };
    const evaluation = evaluateHumanResult({
      requirement: required,
      result,
      catalog: defineMethodCatalog([WORLD_ID_PROOF_OF_HUMAN_METHOD]),
      now,
    });
    expect(evaluation.satisfied).toBe(false);
    expect(evaluation.failures.map(({ code }) => code)).toContain(
      "METHOD_NOT_ACCEPTED",
    );
  });
});

describe("method catalog", () => {
  it("requires explicit non-claims and rejects duplicates", () => {
    expect(() =>
      defineMethodCatalog([
        WORLD_ID_PROOF_OF_HUMAN_METHOD,
        WORLD_ID_PROOF_OF_HUMAN_METHOD,
      ]),
    ).toThrow("Duplicate human method");
  });

  it("publishes legacy Orb as a non-equivalent method", () => {
    expect(WORLD_ID_LEGACY_ORB_METHOD.methodId).toBe("orb-legacy");
    expect(WORLD_ID_LEGACY_ORB_METHOD.nonClaims).toContain(
      "Equivalence to World ID 4 Proof of Human or any non-World method",
    );
  });
});
