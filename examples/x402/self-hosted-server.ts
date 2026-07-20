import express from "express";
import { createClient } from "redis";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { createX424 } from "x424";
import {
  createX424HttpRouter,
  createStaticBearerIssuanceAuthenticator,
} from "x424/express";
import {
  X424Service,
  generatePairwiseSecret,
  generateResultKeyPair,
} from "x424/core";
import { RedisX424Store } from "x424/redis";
import { worldProofOfHuman } from "x424/world";
import { composeX424BeforeX402 } from "x424/x402";

const redis = createClient({ url: process.env.REDIS_URL! });
await redis.connect();
const state = new RedisX424Store({ client: redis });
const resultKeys = generateResultKeyPair("x424-example-only");
const world = worldProofOfHuman({
  appId: process.env.WORLD_APP_ID!,
  rpId: process.env.WORLD_RP_ID!,
  signingKeyHex: process.env.WORLD_RP_SIGNING_KEY!,
  action: "paid-api-example",
  environment: "staging",
});
const verifier = new X424Service({
  catalog: world.catalog,
  adapters: [world.adapter],
  nonceStore: state.nonces,
  providerReplayStore: state.providers,
  pairwiseSecret: generatePairwiseSecret(),
  resultSigner: resultKeys.signer,
});

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(
  "/x424",
  createX424HttpRouter({
    service: verifier,
    providerRequests: world.providerRequests,
    requirementStore: state.requirements,
    deploymentProfile: "dev-local-0.1",
    issuanceAuthenticator: createStaticBearerIssuanceAuthenticator({
      [process.env.X424_ISSUANCE_TOKEN!]: {
        subject: "paid-api-example",
        __devWildcardIssuance: true,
      },
    }),
  }),
);

const x424 = createX424({
  deploymentProfile: "dev-local-0.1",
  purpose: "paid-api-example",
  audience: "http://127.0.0.1:3000",
  accepts: world.accepts,
  catalog: world.catalog,
  verifier: resultKeys.verifier,
  extractBinding: async ({ headers }) => ({
    kind: "request",
    value: headers.get("idempotency-key")!,
  }),
  requirementStore: state.requirements,
  replayStore: state.results,
  resultAcceptanceStore: state.resultAcceptances,
  providerRequests: world.providerRequests,
  publicOrigin: { publicOrigin: "http://127.0.0.1:3000" },
});
const paymentServer = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: process.env.X402_FACILITATOR_URL! }),
).register("eip155:84532", new ExactEvmScheme());
const payment = paymentMiddleware(
  {
    "POST /paid-action": {
      accepts: {
        scheme: "exact",
        price: "$0.01",
        network: "eip155:84532",
        payTo: process.env.X402_PAY_TO!,
      },
      description: "One unique human, one paid action",
    },
  },
  paymentServer,
);

app.post(
  "/paid-action",
  ...composeX424BeforeX402(x424.express(), payment),
  (_request, response) => response.status(201).json({ executed: true }),
);
app.listen(3000);
