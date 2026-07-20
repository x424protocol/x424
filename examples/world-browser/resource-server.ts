/**
 * Resource server using public middleware only. Application authorization is
 * intentionally separate and not implemented here.
 */
import express from "express";
import {
  InMemoryRequirementStore,
  InMemoryResultReplayStore,
  defineMethodCatalog,
} from "../../src/core.js";
import { createExpressHumanDependencyMiddleware } from "../../src/middleware/resource.js";
import { WORLD_ID_PROOF_OF_HUMAN_METHOD } from "../../src/providers/world-id.js";
import { generateResultKeyPair } from "../../src/result-token.js";

const keys = generateResultKeyPair("resource-demo");
// In a real deployment, load the verifier's public key from authenticated metadata.
const catalog = defineMethodCatalog([WORLD_ID_PROOF_OF_HUMAN_METHOD]);
const app = express();
app.use(express.json());

app.post(
  "/records",
  createExpressHumanDependencyMiddleware({
    purpose: "publish-record",
    audience: "http://127.0.0.1:9090",
    accepts: [
      {
        providerId: WORLD_ID_PROOF_OF_HUMAN_METHOD.providerId,
        methodId: WORLD_ID_PROOF_OF_HUMAN_METHOD.methodId,
        descriptorVersion: WORLD_ID_PROOF_OF_HUMAN_METHOD.version,
        acceptedScopeKinds: ["action"],
        verificationModes: ["backend"],
      },
    ],
    catalog,
    verifier: keys.verifier,
    requirementStore: new InMemoryRequirementStore(),
    replayStore: new InMemoryResultReplayStore(),
    extractBinding: async ({ headers }) => {
      const value = headers.get("x-session-binding");
      if (!value) throw new Error("Missing authenticated session binding");
      return { kind: "session", value };
    },
  }),
  (_request, response) => {
    response.status(201).json({ ok: true });
  },
);

const port = Number(process.env.PORT ?? 9090);
app.listen(port, () => {
  console.log(JSON.stringify({ msg: "resource listening", port }));
});
