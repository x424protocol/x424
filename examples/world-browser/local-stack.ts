/**
 * Single-process local stack: verifier + resource using shared keys/stores.
 * Demonstrates public APIs only. Profile: dev-local-0.1.
 */
import express from "express";
import { randomBytes } from "node:crypto";
import { createX424HttpRouter } from "../../src/api/router.js";
import {
  InMemoryNonceStore,
  InMemoryProviderReplayStore,
  InMemoryRequirementStore,
  InMemoryResultReplayStore,
  defineMethodCatalog,
} from "../../src/core.js";
import {
  encodeHumanRequirement,
  humanRequiredResponse,
} from "../../src/http.js";
import { createExpressHumanDependencyMiddleware } from "../../src/middleware/resource.js";
import {
  WORLD_ID_PROOF_OF_HUMAN_METHOD,
  createWorldIdMethodRequirements,
} from "../../src/providers/world-id.js";
import { createHumanRequirement } from "../../src/requirements.js";
import { generateResultKeyPair } from "../../src/result-token.js";
import { X424Service } from "../../src/service.js";
import type {
  HumanProviderAdapter,
  ProviderVerifiedHuman,
} from "../../src/types.js";

const port = Number(process.env.PORT ?? 9070);
const audience = `http://127.0.0.1:${port}`;
const keys = generateResultKeyPair("local-stack");
const catalog = defineMethodCatalog([WORLD_ID_PROOF_OF_HUMAN_METHOD]);
const requirementStore = new InMemoryRequirementStore();
const replayStore = new InMemoryResultReplayStore();

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
    requirementStore,
    deploymentProfile: "dev-local-0.1",
    providerRequests: async () => ({
      "world:proof-of-human": {
        environment: "staging",
        action: "publish-record",
        allowLegacyProofs: false,
      },
    }),
  }),
);

app.post(
  "/records",
  async (request, response, next) => {
    const bindingHeader = request.get("x-session-binding");
    if (!bindingHeader) {
      return response.status(401).json({ detail: "session binding required" });
    }
    if (!request.get("human-proof")) {
      if (!request.get("idempotency-key")) {
        return response.status(400).type("application/problem+json").json({
          type: "https://x424.org/problems/idempotency-key-required",
          title: "IDEMPOTENCY_KEY_REQUIRED",
          status: 400,
          detail: "Mutations require Idempotency-Key",
        });
      }
      const requirement = createHumanRequirement({
        purpose: "publish-record",
        method: "POST",
        uri: `${audience}/records`,
        audience,
        body: request.body,
        binding: { kind: "session", value: bindingHeader },
        accepts: createWorldIdMethodRequirements({ allowLegacyProofs: false }),
        providerRequests: {
          "world:proof-of-human": {
            environment: "staging",
            action: "publish-record",
            allowLegacyProofs: false,
          },
        },
      });
      await requirementStore.put(requirement);
      await service.register(requirement);
      const challenge = humanRequiredResponse(requirement);
      response.set("human-required", encodeHumanRequirement(requirement));
      for (const [key, value] of Object.entries(challenge.headers)) {
        response.setHeader(key, value);
      }
      return response.status(424).json(challenge.body);
    }
    return next();
  },
  createExpressHumanDependencyMiddleware({
    purpose: "publish-record",
    audience,
    accepts: createWorldIdMethodRequirements({ allowLegacyProofs: false }),
    catalog,
    verifier: keys.verifier,
    requirementStore,
    replayStore,
    requireIdempotencyKey: false,
    extractBinding: async ({ headers }) => {
      const value = headers.get("x-session-binding");
      if (!value) throw new Error("Missing authenticated session binding");
      return { kind: "session", value };
    },
  }),
  (_request, response) => {
    response.status(201).json({ ok: true, note: "HUMAN-PROOF accepted" });
  },
);

app.listen(port, () => {
  console.log(
    JSON.stringify({
      msg: "local-stack listening",
      port,
      profile: "dev-local-0.1",
      legacyDefault: false,
    }),
  );
});
