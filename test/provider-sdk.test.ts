import { describe, expect, it } from "vitest";
import {
  X424Service,
  assertHumanProviderAdapterConformance,
  defineHumanMethodDescriptor,
  defineHumanProviderAdapter,
  defineMethodCatalog,
  generatePairwiseSecret,
  generateResultKeyPair,
  InMemoryNonceStore,
  InMemoryProviderReplayStore,
  inspectHumanProviderAdapter,
  sha256,
} from "../src/core.js";

const method = defineHumanMethodDescriptor({
  providerId: "example",
  methodId: "unique-human",
  version: "1",
  status: "enabled",
  claim: "The example provider accepted one unique human.",
  nonClaims: ["Legal identity", "Authorization"],
  assuranceLevels: ["standard"],
  nativeScopeKinds: ["relying_party"],
  verificationModes: ["backend"],
  pairwisePseudonym: true,
  replaySemantics: "Proofs are single-use.",
  recoverySemantics: "The provider defines recovery.",
  privacy: "Provider subjects remain inside the verifier.",
});

describe("provider adapter SDK", () => {
  it("defines a frozen, conforming provider adapter", () => {
    const adapter = defineHumanProviderAdapter({
      providerId: "example",
      methods: [method],
      verify: async () => ({
        providerId: "example",
        methodId: "unique-human",
        descriptorVersion: "1",
        assuranceLevel: "standard",
        providerSubject: "private-subject",
        uniquenessScope: { kind: "relying_party", id: "example:rp" },
        verificationMode: "backend",
        proofDigest: sha256("proof"),
        verifiedAt: new Date().toISOString(),
      }),
    });

    expect(inspectHumanProviderAdapter(adapter)).toEqual({
      conformant: true,
      providerId: "example",
      methods: ["example:unique-human@1"],
      issues: [],
    });
    expect(Object.isFrozen(adapter)).toBe(true);
    expect(Object.isFrozen(adapter.methods())).toBe(true);
    expect(Object.isFrozen(adapter.methods()[0]!.nonClaims)).toBe(true);
    expect(() => assertHumanProviderAdapterConformance(adapter)).not.toThrow();
  });

  it("rejects invalid identifiers and mismatched provider methods", () => {
    expect(() =>
      defineHumanMethodDescriptor({ ...method, providerId: "Not Portable" }),
    ).toThrow("lowercase protocol identifier");

    const report = inspectHumanProviderAdapter({
      providerId: "another-provider",
      methods: () => [method],
      verify: async () => {
        throw new Error("not called");
      },
    });
    expect(report.conformant).toBe(false);
    expect(report.issues.map(({ code }) => code)).toContain(
      "METHOD_PROVIDER_MISMATCH",
    );
  });

  it("rejects duplicate provider adapters before verifier startup", () => {
    const adapter = defineHumanProviderAdapter({
      providerId: "example",
      methods: [method],
      verify: async () => {
        throw new Error("not called");
      },
    });
    expect(
      () =>
        new X424Service({
          catalog: defineMethodCatalog([method]),
          adapters: [adapter, adapter],
          nonceStore: new InMemoryNonceStore(),
          providerReplayStore: new InMemoryProviderReplayStore(),
          pairwiseSecret: generatePairwiseSecret(),
          resultSigner: generateResultKeyPair().signer,
        }),
    ).toThrow("Duplicate provider adapter");
  });

  it("rejects an enabled method with no verifier adapter", () => {
    expect(
      () =>
        new X424Service({
          catalog: defineMethodCatalog([method]),
          adapters: [],
          nonceStore: new InMemoryNonceStore(),
          providerReplayStore: new InMemoryProviderReplayStore(),
          pairwiseSecret: generatePairwiseSecret(),
          resultSigner: generateResultKeyPair().signer,
        }),
    ).toThrow("Enabled catalog method has no adapter");
  });
});
