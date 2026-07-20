#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const suffix = `${process.pid}-${Date.now()}`;
const network = `x424-smoke-${suffix}`;
const redis = `x424-smoke-redis-${suffix}`;
const verifier = `x424-smoke-verifier-${suffix}`;
const image = `x424-verifier-smoke:${suffix}`;

function docker(args, options = {}) {
  return execFileSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.quiet ? "pipe" : "inherit",
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(url) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw lastError ?? new Error("verifier did not become healthy");
}

try {
  docker(["version", "--format", "{{.Server.Version}}"], { quiet: true });
  docker([
    "build",
    "--file",
    "deploy/verifier/Dockerfile",
    "--tag",
    image,
    ".",
  ]);
  const imageUser = docker(
    ["image", "inspect", image, "--format", "{{.Config.User}}"],
    { quiet: true },
  ).trim();
  if (imageUser !== "10001")
    throw new Error(`unexpected image user: ${imageUser}`);

  docker(["network", "create", network], { quiet: true });
  docker(
    [
      "run",
      "--detach",
      "--name",
      redis,
      "--network",
      network,
      "redis:7.2-alpine",
    ],
    { quiet: true },
  );
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      if (
        docker(["exec", redis, "redis-cli", "ping"], { quiet: true }).trim() ===
        "PONG"
      )
        break;
    } catch {
      // Container startup is expected to race the first checks.
    }
    if (attempt === 29) throw new Error("Redis did not become ready");
    await delay(250);
  }

  docker(
    [
      "run",
      "--detach",
      "--name",
      verifier,
      "--network",
      network,
      "--publish",
      "127.0.0.1::8080",
      "--env",
      "X424_DEPLOYMENT_PROFILE=dev-local-0.1",
      "--env",
      "X424_PROVIDER_REQUEST_MODE=verifier",
      "--env",
      `REDIS_URL=redis://${redis}:6379`,
      "--env",
      "X424_PAIRWISE_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "--env",
      "X424_HANDOFF_STATE_KEY=abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      "--env",
      "X424_EPHEMERAL_RESULT_KEY=true",
      "--env",
      'X424_ISSUANCE_PRINCIPALS_JSON={"smoke-token":{"subject":"smoke","allowedPurposes":["sandbox"],"allowedAudiences":["https://api.example.test"],"allowedHttpMethods":["POST"],"allowedMethods":["world:proof-of-human"],"allowedResources":[{"origin":"https://api.example.test","pathPrefix":"/actions"}]}}',
      "--env",
      "WORLD_APP_ID=app_staging_smoke",
      "--env",
      "WORLD_RP_ID=rp_staging_smoke",
      "--env",
      "WORLD_RP_SIGNING_KEY=0xabababababababababababababababababababababababababababababababab",
      "--env",
      "WORLD_ACTION=x424-sandbox",
      "--env",
      "WORLD_ENVIRONMENT=staging",
      "--env",
      "WORLD_ALLOW_LEGACY_PROOFS=false",
      image,
    ],
    { quiet: true },
  );
  const portOutput = docker(["port", verifier, "8080/tcp"], {
    quiet: true,
  }).trim();
  const port = portOutput.match(/:([0-9]+)$/u)?.[1];
  if (!port) throw new Error(`could not resolve verifier port: ${portOutput}`);
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/healthz`);

  const created = await fetch(`${base}/v1/requirements`, {
    method: "POST",
    headers: {
      authorization: "Bearer smoke-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      purpose: "sandbox",
      method: "POST",
      uri: "https://api.example.test/actions/smoke",
      audience: "https://api.example.test",
      binding: { kind: "request", value: "smoke-operation" },
      accepts: [
        {
          providerId: "world",
          methodId: "proof-of-human",
          descriptorVersion: "1",
          acceptedScopeKinds: ["action"],
        },
      ],
    }),
  });
  if (created.status !== 201) {
    throw new Error(
      `requirement issuance failed (${created.status}): ${await created.text()}`,
    );
  }
  const { requirement } = await created.json();
  const acceptance = async (operationId) => {
    const response = await fetch(
      `${base}/v1/results/smoke-result/acceptances`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer smoke-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operationId,
          requestDigest: requirement.resource.requestDigest,
          expiresAt: requirement.expiresAt,
        }),
      },
    );
    if (!response.ok) throw new Error(`acceptance failed: ${response.status}`);
    return (await response.json()).status;
  };
  if ((await acceptance("smoke-operation")) !== "new")
    throw new Error("new acceptance failed");
  if ((await acceptance("smoke-operation")) !== "same_operation")
    throw new Error("same-operation retry failed");
  if ((await acceptance("different-operation")) !== "replay")
    throw new Error("replay rejection failed");
  process.stdout.write(
    "image-smoke ok: non-root, healthy, issuance, acceptance, replay\n",
  );
} finally {
  for (const container of [verifier, redis]) {
    try {
      docker(["rm", "--force", container], { quiet: true });
    } catch {
      // Cleanup is best-effort and targets only this process's unique names.
    }
  }
  try {
    docker(["network", "rm", network], { quiet: true });
  } catch {
    // Cleanup is best-effort.
  }
  try {
    docker(["image", "rm", "--force", image], { quiet: true });
  } catch {
    // Cleanup is best-effort.
  }
}
