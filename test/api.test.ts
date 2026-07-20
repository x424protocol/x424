import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import {
  InMemoryNonceStore,
  InMemoryProviderReplayStore,
  X424Service,
  createWorldIdVerifierProfile,
  createX424HttpRouter,
  generatePairwiseSecret,
  generateResultKeyPair,
  worldIdProviderRequestFromRequirement,
  type HumanRequirement,
} from "../src/index.js";

describe("reference HTTP API", () => {
  const servers: Array<{ close(): void }> = [];

  afterEach(() => servers.splice(0).forEach((server) => server.close()));

  it("issues, verifies, and returns a private signed result", async () => {
    const profile = createWorldIdVerifierProfile({
      appId: "app_test",
      rpId: "rp_test",
      action: "x424-test",
      environment: "staging",
      signingKeyHex: `0x${"ab".repeat(32)}`,
      allowLegacyProofs: true,
      verifyRemote: async () => ({
        success: true,
        action: "x424-test",
        environment: "staging",
        results: [
          {
            identifier: "proof_of_human",
            success: true,
            nullifier: "0xnever-public",
          },
        ],
        created_at: new Date().toISOString(),
      }),
    });
    const service = new X424Service({
      catalog: profile.catalog,
      adapters: [profile.adapter],
      nonceStore: new InMemoryNonceStore(),
      providerReplayStore: new InMemoryProviderReplayStore(),
      pairwiseSecret: generatePairwiseSecret(),
      resultSigner: generateResultKeyPair().signer,
    });
    const app = express();
    app.use(express.json({ limit: "256kb" }));
    app.use(
      createX424HttpRouter({
        service,
        providerRequests: profile.providerRequests,
        deploymentProfile: "dev-local-0.1",
        allowUnauthenticatedIssuance: true,
      }),
    );
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    const created = await fetch(`${base}/v1/requirements`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "test",
        method: "POST",
        uri: "https://api.example.test/action",
        audience: "https://api.example.test",
        binding: { kind: "agent_key", value: "sha256:test" },
        accepts: profile.accepts,
      }),
    });
    expect(created.status).toBe(201);
    expect(created.headers.get("human-required")).toBeTruthy();
    const createdBody = (await created.json()) as {
      requirement: HumanRequirement;
    };
    const providerRequest = worldIdProviderRequestFromRequirement(
      createdBody.requirement,
    );

    const verified = await fetch(
      `${base}/v1/requirements/${createdBody.requirement.dependencyId}/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          x424Version: "0.1",
          dependencyId: createdBody.requirement.dependencyId,
          providerId: "world",
          methodId: "proof-of-human",
          binding: createdBody.requirement.binding,
          nativeProof: {
            protocol_version: "4.0",
            nonce: providerRequest.rpContext.nonce,
            action: providerRequest.action,
            environment: providerRequest.environment,
            responses: [
              {
                identifier: "proof_of_human",
                signal_hash: providerRequest.signalHash,
                proof: ["opaque"],
                nullifier: "0xnever-public",
                issuer_schema_id: 1,
                expires_at_min: 1_800_000_000,
              },
            ],
          },
        }),
      },
    );
    expect(verified.status).toBe(200);
    expect(verified.headers.get("human-result")).toMatch(/^ey/);
    const verifiedText = await verified.text();
    expect(verifiedText).not.toContain("never-public");
    expect(verifiedText).toContain("x424_human_");
  });

  it("never echoes adapter secrets in public problems or telemetry", async () => {
    const observed: Array<{ code: string; redacted: unknown }> = [];
    const profile = createWorldIdVerifierProfile({
      appId: "app_test",
      rpId: "rp_test",
      action: "x424-test",
      environment: "staging",
      signingKeyHex: `0x${"cd".repeat(32)}`,
      verifyRemote: async () => {
        throw new Error(
          "adapter failed nullifier_hash=0xleaked nativeProof=rawsecret token=abc",
        );
      },
    });
    const service = new X424Service({
      catalog: profile.catalog,
      adapters: [profile.adapter],
      nonceStore: new InMemoryNonceStore(),
      providerReplayStore: new InMemoryProviderReplayStore(),
      pairwiseSecret: generatePairwiseSecret(),
      resultSigner: generateResultKeyPair().signer,
    });
    const app = express();
    app.use(express.json({ limit: "256kb" }));
    app.use(
      createX424HttpRouter({
        service,
        providerRequests: profile.providerRequests,
        deploymentProfile: "dev-local-0.1",
        allowUnauthenticatedIssuance: true,
        onInternalError: (event) => {
          observed.push({ code: event.code, redacted: event.redacted });
        },
      }),
    );
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    const created = await fetch(`${base}/v1/requirements`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "test",
        method: "POST",
        uri: "https://api.example.test/action",
        audience: "https://api.example.test",
        binding: { kind: "agent_key", value: "sha256:test" },
        accepts: profile.accepts,
      }),
    });
    const createdBody = (await created.json()) as {
      requirement: HumanRequirement;
    };
    const providerRequest = worldIdProviderRequestFromRequirement(
      createdBody.requirement,
    );
    const verified = await fetch(
      `${base}/v1/requirements/${createdBody.requirement.dependencyId}/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          x424Version: "0.1",
          dependencyId: createdBody.requirement.dependencyId,
          providerId: "world",
          methodId: "proof-of-human",
          binding: createdBody.requirement.binding,
          nativeProof: {
            protocol_version: "4.0",
            nonce: providerRequest.rpContext.nonce,
            action: providerRequest.action,
            environment: providerRequest.environment,
            responses: [
              {
                identifier: "proof_of_human",
                signal_hash: providerRequest.signalHash,
                proof: ["opaque"],
                nullifier: "0xleaked",
                issuer_schema_id: 1,
                expires_at_min: 1_800_000_000,
              },
            ],
          },
        }),
      },
    );
    expect(verified.status).toBe(422);
    const problemText = await verified.text();
    expect(problemText).not.toMatch(/nullifier|rawsecret|0xleaked|token=abc/i);
    expect(problemText).toContain("PROOF_REJECTED");
    expect(JSON.stringify(observed)).not.toMatch(
      /nullifier|rawsecret|0xleaked|token=abc/i,
    );
  });
});
