/**
 * Local verifier with a fake World-shaped adapter for fixtures.
 * Legacy is disabled. Not a production profile.
 */
import express from "express";
import { randomBytes } from "node:crypto";
import { createX424HttpRouter } from "../../src/api/router.js";
import {
  InMemoryNonceStore,
  InMemoryProviderReplayStore,
  InMemoryRequirementStore,
  defineMethodCatalog,
} from "../../src/core.js";
import {
  WORLD_ID_PROOF_OF_HUMAN_METHOD,
  createWorldIdMethodRequirements,
} from "../../src/providers/world-id.js";
import { generateResultKeyPair } from "../../src/result-token.js";
import { X424Service } from "../../src/service.js";
import type {
  HumanProviderAdapter,
  ProviderVerifiedHuman,
} from "../../src/types.js";

const keys = generateResultKeyPair("verifier-demo");
const catalog = defineMethodCatalog([WORLD_ID_PROOF_OF_HUMAN_METHOD]);

const fakeWorldAdapter: HumanProviderAdapter = {
  providerId: "world",
  methods: () => [WORLD_ID_PROOF_OF_HUMAN_METHOD],
  async verify({ requirement, proof }): Promise<ProviderVerifiedHuman> {
    if (proof.methodId !== "proof-of-human") {
      throw new Error("Legacy and unknown methods are rejected");
    }
    const native = proof.nativeProof as { binding?: string; fixture?: boolean };
    if (!native?.fixture || native.binding !== requirement.binding.value) {
      throw new Error("Native binding mismatch");
    }
    return {
      providerId: "world",
      methodId: "proof-of-human",
      descriptorVersion: "1",
      providerSubject: "fake-nullifier-never-returned",
      uniquenessScope: { kind: "action", id: "world:action:publish-record" },
      verificationMode: "backend",
      providerReplayMode: "verifier",
      proofDigest: "sha256:fake-proof",
      verifiedAt: new Date().toISOString(),
    };
  },
};

const service = new X424Service({
  catalog,
  adapters: [fakeWorldAdapter],
  nonceStore: new InMemoryNonceStore(),
  providerReplayStore: new InMemoryProviderReplayStore(),
  pairwiseSecret: randomBytes(32),
  resultSigner: keys.signer,
});

const app = express();
app.use(express.json({ limit: "64kb" }));
app.use(
  createX424HttpRouter({
    service,
    requirementStore: new InMemoryRequirementStore(),
    deploymentProfile: "dev-local-0.1",
    providerRequests: async ({ purpose, binding, accepts }) => {
      // Trusted backend only — never accept client-supplied RP signing material.
      void purpose;
      void binding;
      void accepts;
      return {
        "world:proof-of-human": {
          environment: "staging",
          action: "publish-record",
          allowLegacyProofs: false,
        },
      };
    },
  }),
);

const port = Number(process.env.PORT ?? 9080);
app.listen(port, () => {
  console.log(
    JSON.stringify({
      msg: "verifier listening",
      port,
      accepts: createWorldIdMethodRequirements({ allowLegacyProofs: false }),
      note: "dev-local-0.1 — not for production value",
    }),
  );
});
