import {
  canonicalJson,
  defineHumanMethodDescriptor,
  defineHumanProviderAdapter,
  sha256,
} from "../src/core.js";

const EXAMPLE_UNIQUE_HUMAN = defineHumanMethodDescriptor({
  providerId: "example",
  methodId: "unique-human",
  version: "1",
  status: "enabled",
  claim: "The example provider accepted one unique human.",
  nonClaims: ["Legal identity", "Authorization", "Provider equivalence"],
  assuranceLevels: ["example"],
  nativeScopeKinds: ["relying_party"],
  verificationModes: ["backend"],
  pairwisePseudonym: true,
  replaySemantics: "Provider proof and x424 nonce are single-use.",
  recoverySemantics: "The example provider controls recovery.",
  privacy: "The provider subject remains inside the verifier boundary.",
});

export const exampleProviderAdapter = defineHumanProviderAdapter({
  providerId: "example",
  methods: [EXAMPLE_UNIQUE_HUMAN],
  validateProviderRequest: ({ providerRequest }) => {
    if (providerRequest !== undefined) {
      throw new Error("The example provider does not use request material");
    }
  },
  verify: async ({ proof }) => {
    // Replace this branch with exact provider cryptography or a pinned backend
    // verification API. Never trust fields copied directly from client JSON.
    throw new Error(
      `Implement native verification for ${sha256(canonicalJson(proof.nativeProof))}`,
    );
  },
});
