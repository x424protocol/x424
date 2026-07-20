import express from "express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { createX424 } from "x424";
import { ManagedVerifierClient } from "x424/managed";
import { worldProofOfHuman } from "x424/world";
import { composeX424BeforeX402 } from "x424/x402";

const managed = new ManagedVerifierClient({
  baseUrl: process.env.X424_VERIFIER_URL!,
  headers: () => ({
    authorization: `Bearer ${process.env.X424_PROJECT_TOKEN!}`,
  }),
});
const world = worldProofOfHuman({
  appId: process.env.WORLD_APP_ID!,
  rpId: process.env.WORLD_RP_ID!,
  signingKeyHex: process.env.WORLD_RP_SIGNING_KEY!,
  action: "paid-api-example",
  environment: "production",
});
const x424 = createX424({
  deploymentProfile: "prod-ha-0.2",
  purpose: "paid-api-example",
  audience: "https://api.example.com",
  accepts: world.accepts,
  catalog: world.catalog,
  verifier: {
    keyId: process.env.X424_RESULT_KEY_ID!,
    publicKey: process.env.X424_RESULT_PUBLIC_KEY!,
  },
  extractBinding: async ({ headers }) => ({
    kind: "request",
    value: headers.get("idempotency-key")!,
  }),
  requirementIssuer: managed,
  requirementStore: managed.requirementStore(),
  replayStore: managed.resultReplayStore(),
  resultAcceptanceStore: managed.resultAcceptanceStore(),
  // Signed on this adopter backend; the managed verifier never sees the key.
  providerRequests: world.providerRequests,
  publicOrigin: { publicOrigin: "https://api.example.com" },
});
const paymentServer = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: process.env.X402_FACILITATOR_URL! }),
).register("eip155:8453", new ExactEvmScheme());
const payment = paymentMiddleware(
  {
    "POST /paid-action": {
      accepts: {
        scheme: "exact",
        price: "$0.01",
        network: "eip155:8453",
        payTo: process.env.X402_PAY_TO!,
      },
      description: "One unique human, one paid action",
    },
  },
  paymentServer,
);

const app = express();
app.use(express.json({ limit: "256kb" }));
app.post(
  "/paid-action",
  ...composeX424BeforeX402(x424.express(), payment),
  (_request, response) => response.status(201).json({ executed: true }),
);
app.listen(3000);
