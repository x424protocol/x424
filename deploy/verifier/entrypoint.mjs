/** Runnable self-hosted x424 verifier image entrypoint. */

import { createPrivateKey } from "node:crypto";
import { pathToFileURL } from "node:url";
import express from "express";
import { createClient } from "redis";
import {
  CircuitBreaker,
  X424Service,
  createStaticBearerIssuanceAuthenticator,
  createX424HttpRouter,
  generateResultKeyPair,
} from "./dist/index.js";
import { RedisRateLimiter, RedisX424Store } from "./dist/redis.js";
import {
  AesGcmHandoffStateProtector,
  HumanHandoffService,
} from "./dist/handoff.js";
import {
  WorldIdAdapter,
  createWorldIdMethodRequirements,
  createWorldIdVerifierProfile,
} from "./dist/providers/world-id.js";
import { defineMethodCatalog } from "./dist/catalog.js";
import { createWorldIdHandoffAdapter } from "./dist/providers/world-id-client.js";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required configuration: ${name}`);
  return value;
}

function integer(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function boolean(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function localSecret(value) {
  const bytes = /^[0-9a-f]{64,}$/iu.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value.replace(/^base64:/u, ""), "base64");
  if (bytes.byteLength < 32) {
    throw new Error("X424_PAIRWISE_SECRET must contain at least 32 bytes");
  }
  return bytes;
}

function handoffStateProtector() {
  const bytes = localSecret(required("X424_HANDOFF_STATE_KEY"));
  if (bytes.byteLength !== 32) {
    throw new Error("X424_HANDOFF_STATE_KEY must contain exactly 32 bytes");
  }
  return new AesGcmHandoffStateProtector(bytes);
}

function parsePrincipals() {
  let value;
  try {
    value = JSON.parse(required("X424_ISSUANCE_PRINCIPALS_JSON"));
  } catch (error) {
    throw new Error("X424_ISSUANCE_PRINCIPALS_JSON must be valid JSON", {
      cause: error,
    });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "X424_ISSUANCE_PRINCIPALS_JSON must map tokens to principals",
    );
  }
  return value;
}

async function keyBoundary(profile) {
  const modulePath = process.env.X424_KEY_MODULE;
  if (modulePath) {
    const moduleUrl = modulePath.startsWith("file:")
      ? modulePath
      : pathToFileURL(modulePath).href;
    const loaded = await import(moduleUrl);
    if (
      !loaded.resultSigner ||
      !loaded.pairwiseDeriver ||
      !loaded.handoffStateProtector
    ) {
      throw new Error(
        "X424_KEY_MODULE must export resultSigner, pairwiseDeriver, and handoffStateProtector",
      );
    }
    return {
      resultSigner: loaded.resultSigner,
      pairwiseDeriver: loaded.pairwiseDeriver,
      handoffStateProtector: loaded.handoffStateProtector,
    };
  }
  if (profile === "prod-ha-0.2") {
    throw new Error("prod-ha-0.2 requires a non-exportable X424_KEY_MODULE");
  }
  if (profile === "dev-local-0.1" && boolean("X424_EPHEMERAL_RESULT_KEY")) {
    return {
      resultSigner: generateResultKeyPair("x424-local-ephemeral").signer,
      pairwiseSecret: localSecret(required("X424_PAIRWISE_SECRET")),
      handoffStateProtector: handoffStateProtector(),
    };
  }
  const privateKey = required("X424_RESULT_PRIVATE_KEY").replaceAll(
    "\\n",
    "\n",
  );
  createPrivateKey(privateKey);
  return {
    resultSigner: {
      keyId: required("X424_RESULT_KEY_ID"),
      privateKey,
    },
    pairwiseSecret: localSecret(required("X424_PAIRWISE_SECRET")),
    handoffStateProtector: handoffStateProtector(),
  };
}

const profile = process.env.X424_DEPLOYMENT_PROFILE ?? "eval-redis-0.2";
if (!["dev-local-0.1", "eval-redis-0.2", "prod-ha-0.2"].includes(profile)) {
  throw new Error("Unsupported X424_DEPLOYMENT_PROFILE");
}
const providerRequestMode =
  process.env.X424_PROVIDER_REQUEST_MODE ?? "verifier";
if (providerRequestMode !== "verifier" && providerRequestMode !== "issuer") {
  throw new Error("X424_PROVIDER_REQUEST_MODE must be verifier or issuer");
}

const redis = createClient({ url: required("REDIS_URL") });
redis.on("error", () => {
  console.error(JSON.stringify({ level: "error", code: "REDIS_ERROR" }));
});
await redis.connect();
const state = new RedisX424Store({
  client: redis,
  keyPrefix: process.env.X424_REDIS_PREFIX ?? "x424",
});
const rateLimiter = new RedisRateLimiter({
  client: redis,
  windowMs: integer("X424_RATE_WINDOW_MS", 60_000, 1_000, 3_600_000),
  maxRequests: integer("X424_RATE_MAX", 120, 1, 1_000_000),
});

const environment = process.env.WORLD_ENVIRONMENT ?? "staging";
if (environment !== "production" && environment !== "staging") {
  throw new Error("WORLD_ENVIRONMENT must be production or staging");
}
const worldBase = {
  appId: required("WORLD_APP_ID"),
  rpId: required("WORLD_RP_ID"),
  action: required("WORLD_ACTION"),
  environment,
  allowLegacyProofs: boolean("WORLD_ALLOW_LEGACY_PROOFS"),
  allowedEgressOrigins: [
    environment === "production"
      ? "https://developer.world.org"
      : "https://staging-developer.worldcoin.org",
  ],
  circuitBreaker: new CircuitBreaker({
    failureThreshold: integer("WORLD_CIRCUIT_FAILURES", 5, 1, 100),
    coolDownMs: integer("WORLD_CIRCUIT_COOLDOWN_MS", 30_000, 1_000, 3_600_000),
  }),
};

let adapter;
let catalog;
let accepts;
let providerRequests;
if (providerRequestMode === "verifier") {
  const world = createWorldIdVerifierProfile({
    ...worldBase,
    signingKeyHex: required("WORLD_RP_SIGNING_KEY"),
  });
  adapter = world.adapter;
  catalog = world.catalog;
  accepts = world.accepts;
  providerRequests = world.providerRequests;
} else {
  adapter = new WorldIdAdapter(worldBase);
  catalog = defineMethodCatalog(adapter.methods());
  accepts = createWorldIdMethodRequirements({
    allowLegacyProofs: worldBase.allowLegacyProofs,
    maximumProofAgeSeconds: 300,
  });
}

const keys = await keyBoundary(profile);
const service = new X424Service({
  catalog,
  adapters: [adapter],
  nonceStore: state.nonces,
  providerReplayStore: state.providers,
  resultSigner: keys.resultSigner,
  ...(keys.pairwiseDeriver
    ? { pairwiseDeriver: keys.pairwiseDeriver }
    : { pairwiseSecret: keys.pairwiseSecret }),
});
const handoffService = new HumanHandoffService({
  service,
  requirementStore: state.requirements,
  store: state.handoffs,
  protector: keys.handoffStateProtector,
  adapters: [createWorldIdHandoffAdapter()],
});
const issuanceAuthenticator =
  createStaticBearerIssuanceAuthenticator(parsePrincipals());
const metadataToken = process.env.X424_METADATA_TOKEN;
if (profile === "prod-ha-0.2" && !metadataToken) {
  throw new Error("prod-ha-0.2 requires X424_METADATA_TOKEN");
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb", strict: true }));
if (metadataToken) {
  app.get("/.well-known/x424-verifier", async (request, response) => {
    try {
      await issuanceAuthenticator.authenticate({
        authorizationHeader: request.get("authorization"),
      });
      response
        .set("cache-control", "no-store, private")
        .json({ token: metadataToken });
    } catch {
      response.status(401).type("application/problem+json").json({
        type: "https://x424.org/problems/unauthenticated",
        title: "UNAUTHENTICATED",
        status: 401,
        detail: "Authentication is required.",
      });
    }
  });
}
app.use(
  createX424HttpRouter({
    service,
    deploymentProfile: profile,
    requirementStore: state.requirements,
    resultReplayStore: state.results,
    resultAcceptanceStore: state.resultAcceptances,
    handoffService,
    issuanceAuthenticator,
    rateLimiter,
    readinessCheck: async () => {
      const pong = await redis.ping();
      if (pong !== "PONG") throw new Error("Redis is not ready");
    },
    ...(providerRequests
      ? { providerRequests }
      : { allowIssuerProviderRequests: true }),
    onInternalError: (event) => {
      console.error(
        JSON.stringify({
          level: "warn",
          code: event.code,
          status: event.status,
          redacted: event.redacted,
        }),
      );
    },
  }),
);
app.use((_error, _request, response, _next) => {
  response.status(400).type("application/problem+json").json({
    type: "https://x424.org/problems/invalid-request",
    title: "INVALID_REQUEST",
    status: 400,
    detail: "The request could not be processed.",
  });
});

const port = integer("PORT", 8080, 1, 65_535);
let shuttingDown = false;
const server = app.listen(port, "0.0.0.0", () => {
  console.log(
    JSON.stringify({
      level: "info",
      code: "VERIFIER_LISTENING",
      port,
      profile,
      providerRequestMode,
      methods: accepts.map(
        ({ providerId, methodId }) => `${providerId}:${methodId}`,
      ),
    }),
  );
});
server.headersTimeout = 15_000;
server.requestTimeout = 20_000;
server.keepAliveTimeout = 5_000;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ level: "info", code: "SHUTDOWN", signal }));
  server.close(async () => {
    try {
      await redis.quit();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
