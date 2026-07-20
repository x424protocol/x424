import { describe, expect, it, vi } from "vitest";
import {
  AesGcmHandoffStateProtector,
  HumanHandoffService,
  InMemoryHandoffStore,
  parseStoredHumanHandoff,
} from "../src/handoff.js";
import {
  InMemoryNonceStore,
  InMemoryProviderReplayStore,
  InMemoryRequirementStore,
  X424Service,
  createHumanRequirement,
  defineHumanMethodDescriptor,
  defineMethodCatalog,
  generatePairwiseSecret,
  generateResultKeyPair,
  sha256,
  verifyHumanResultToken,
  type HumanProviderAdapter,
} from "../src/core.js";

const descriptor = defineHumanMethodDescriptor({
  providerId: "example",
  methodId: "unique-human",
  version: "1",
  status: "enabled",
  claim: "Example unique human",
  nonClaims: ["Authorization"],
  assuranceLevels: [],
  nativeScopeKinds: ["relying_party"],
  verificationModes: ["backend"],
  pairwisePseudonym: true,
  replaySemantics: "single-use",
  recoverySemantics: "provider-defined",
  privacy: "pairwise",
});

async function fixture() {
  const requirements = new InMemoryRequirementStore();
  const nonces = new InMemoryNonceStore();
  const keys = generateResultKeyPair();
  const provider: HumanProviderAdapter = {
    providerId: "example",
    methods: () => [descriptor],
    validateProviderRequest: () => undefined,
    verify: async ({ proof }) => ({
      providerId: "example",
      methodId: "unique-human",
      descriptorVersion: "1",
      providerSubject: "private-provider-subject",
      uniquenessScope: { kind: "relying_party", id: "example:rp" },
      verificationMode: "backend",
      proofDigest: sha256(JSON.stringify(proof.nativeProof)),
      verifiedAt: new Date().toISOString(),
    }),
  };
  const service = new X424Service({
    catalog: defineMethodCatalog([descriptor]),
    adapters: [provider],
    nonceStore: nonces,
    providerReplayStore: new InMemoryProviderReplayStore(),
    pairwiseSecret: generatePairwiseSecret(),
    resultSigner: keys.signer,
  });
  const requirement = createHumanRequirement({
    purpose: "publish-record",
    method: "POST",
    uri: "https://api.example.test/records",
    audience: "https://api.example.test",
    binding: { kind: "agent_key", value: "sha256:agent" },
    accepts: [
      {
        providerId: "example",
        methodId: "unique-human",
        descriptorVersion: "1",
        acceptedScopeKinds: ["relying_party"],
      },
    ],
    providerRequests: { "example:unique-human": { request: "opaque" } },
  });
  await requirements.put(requirement);
  await service.register(requirement);
  return { requirements, service, keys, requirement };
}

describe("brokered human handoff", () => {
  it("fails closed when durable handoff state is malformed", () => {
    expect(() =>
      parseStoredHumanHandoff({
        handoffId: "handoff-corrupt",
        dependencyId: "dependency",
        accessTokenDigest: "sha256:capability",
        status: "completed",
        version: 1,
      }),
    ).toThrow("Invalid durable handoff state");
  });

  it("returns only a signed x424 result after an authorized poll", async () => {
    const { requirements, service, keys, requirement } = await fixture();
    const pollHandoff = vi
      .fn()
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({
        status: "completed",
        nativeProof: { proof: "never-public" },
      });
    const handoffs = new HumanHandoffService({
      service,
      requirementStore: requirements,
      store: new InMemoryHandoffStore(),
      protector: new AesGcmHandoffStateProtector(new Uint8Array(32).fill(7)),
      adapters: [
        {
          providerId: "example",
          methodIds: ["unique-human"],
          startHandoff: async () => ({
            providerSession: { privateSession: "never-public" },
            presentation: {
              kind: "uri",
              uri: "https://wallet.example/connect/private-capability",
            },
            expiresAt: requirement.expiresAt,
          }),
          pollHandoff,
        },
      ],
    });

    const started = await handoffs.start({
      dependencyId: requirement.dependencyId,
      nonce: requirement.nonce,
      providerId: "example",
      methodId: "unique-human",
    });
    expect(started.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    await expect(
      handoffs.poll(started.handoffId, "A".repeat(43)),
    ).rejects.toThrow("Unknown handoff");
    await expect(
      handoffs.poll(started.handoffId, started.accessToken),
    ).resolves.toMatchObject({ status: "pending" });
    const completed = await handoffs.poll(
      started.handoffId,
      started.accessToken,
    );
    expect(completed.status).toBe("completed");
    expect(JSON.stringify(completed)).not.toContain("never-public");
    if (completed.status !== "completed") throw new Error("not completed");
    const result = verifyHumanResultToken(completed.humanProof, keys.verifier);
    expect(result.dependencyId).toBe(requirement.dependencyId);
    await expect(requirements.get(requirement.dependencyId)).resolves.toEqual(
      requirement,
    );
    await expect(
      handoffs.poll(started.handoffId, started.accessToken),
    ).resolves.toEqual(completed);
  });

  it("allows only one active handoff and supports capability cancellation", async () => {
    const { requirements, service, requirement } = await fixture();
    const cancelHandoff = vi.fn(async () => undefined);
    const handoffs = new HumanHandoffService({
      service,
      requirementStore: requirements,
      store: new InMemoryHandoffStore(),
      protector: new AesGcmHandoffStateProtector(new Uint8Array(32).fill(8)),
      adapters: [
        {
          providerId: "example",
          methodIds: ["unique-human"],
          startHandoff: async () => ({
            providerSession: { id: "private" },
            presentation: { kind: "uri", uri: "https://wallet.example" },
            expiresAt: requirement.expiresAt,
          }),
          pollHandoff: async () => ({ status: "pending" }),
          cancelHandoff,
        },
      ],
    });
    const input = {
      dependencyId: requirement.dependencyId,
      nonce: requirement.nonce,
      providerId: "example",
      methodId: "unique-human",
    };
    const started = await handoffs.start(input);
    await expect(handoffs.start(input)).rejects.toThrow("active handoff");
    await expect(
      handoffs.cancel(started.handoffId, "B".repeat(43)),
    ).resolves.toBe(false);
    await expect(
      handoffs.cancel(started.handoffId, started.accessToken),
    ).resolves.toBe(true);
    expect(cancelHandoff).toHaveBeenCalledOnce();
    await expect(
      handoffs.poll(started.handoffId, started.accessToken),
    ).resolves.toMatchObject({ status: "cancelled" });
  });

  it("reclaims an expired polling lease after verifier process loss", async () => {
    const { requirements, service, requirement } = await fixture();
    const store = new InMemoryHandoffStore();
    const protector = new AesGcmHandoffStateProtector(
      new Uint8Array(32).fill(9),
    );
    const accessToken = "C".repeat(43);
    await store.create({
      handoffId: "handoff-restart",
      dependencyId: requirement.dependencyId,
      providerId: "example",
      methodId: "unique-human",
      accessTokenDigest: sha256(accessToken),
      status: "polling",
      pollClaimExpiresAt: "2026-07-20T11:59:00.000Z",
      presentation: {
        kind: "uri",
        uri: "https://wallet.example/connect/restart",
      },
      protectedState: protector.protect({ resumable: true }),
      pollAfterMs: 500,
      expiresAt: requirement.expiresAt,
      version: 1,
    });
    const handoffs = new HumanHandoffService({
      service,
      requirementStore: requirements,
      store,
      protector,
      now: () => new Date("2026-07-20T12:00:00.000Z"),
      adapters: [
        {
          providerId: "example",
          methodIds: ["unique-human"],
          startHandoff: async () => {
            throw new Error("not called");
          },
          pollHandoff: async () => ({
            status: "completed",
            nativeProof: { proof: "resumed" },
          }),
        },
      ],
    });

    await expect(
      handoffs.poll("handoff-restart", accessToken),
    ).resolves.toMatchObject({ status: "completed" });
  });
});
