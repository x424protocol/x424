import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import {
  AesGcmHandoffStateProtector,
  HumanHandoffService,
  InMemoryHandoffStore,
  InMemoryNonceStore,
  InMemoryProviderReplayStore,
  InMemoryRequirementStore,
  InMemoryResultAcceptanceStore,
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
    const retained = await fetch(
      `${base}/v1/requirements/${createdBody.requirement.dependencyId}`,
    );
    expect(retained.status).toBe(200);
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

  it("accepts adopter-signed World requests in authenticated issuer mode", async () => {
    const profile = createWorldIdVerifierProfile({
      appId: "app_test",
      rpId: "rp_test",
      action: "x424-test",
      environment: "staging",
      signingKeyHex: `0x${"ef".repeat(32)}`,
      verifyRemote: async () => {
        throw new Error("not called");
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
        allowIssuerProviderRequests: true,
        deploymentProfile: "dev-local-0.1",
        allowUnauthenticatedIssuance: true,
      }),
    );
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    const binding = { kind: "agent_key", value: "sha256:managed" } as const;
    const providerRequests = await profile.providerRequests({
      binding,
      accepts: profile.accepts,
      ttlSeconds: 300,
    });
    const body = {
      purpose: "test",
      method: "POST",
      uri: "https://api.example.test/action",
      audience: "https://api.example.test",
      binding,
      accepts: profile.accepts,
      providerRequests,
    };

    const accepted = await fetch(`${base}/v1/requirements`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(accepted.status).toBe(201);

    const missing = await fetch(`${base}/v1/requirements`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, providerRequests: undefined }),
    });
    expect(missing.status).toBe(400);

    const key = "world:proof-of-human";
    const mismatched = {
      ...providerRequests,
      [key]: {
        ...(providerRequests[key] as Record<string, unknown>),
        action: "another-action",
      },
    };
    const rejected = await fetch(`${base}/v1/requirements`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, providerRequests: mismatched }),
    });
    expect(rejected.status).toBe(400);
  });

  it("exposes capability-scoped handoffs and idempotent result acceptances", async () => {
    const profile = createWorldIdVerifierProfile({
      appId: "app_test",
      rpId: "rp_test",
      action: "x424-test",
      environment: "staging",
      signingKeyHex: `0x${"12".repeat(32)}`,
      verifyRemote: async () => {
        throw new Error("not called while handoff is pending");
      },
    });
    const requirements = new InMemoryRequirementStore();
    const service = new X424Service({
      catalog: profile.catalog,
      adapters: [profile.adapter],
      nonceStore: new InMemoryNonceStore(),
      providerReplayStore: new InMemoryProviderReplayStore(),
      pairwiseSecret: generatePairwiseSecret(),
      resultSigner: generateResultKeyPair().signer,
    });
    const handoffService = new HumanHandoffService({
      service,
      requirementStore: requirements,
      store: new InMemoryHandoffStore(),
      protector: new AesGcmHandoffStateProtector(new Uint8Array(32).fill(5)),
      adapters: [
        {
          providerId: "world",
          methodIds: ["proof-of-human"],
          startHandoff: async ({ requirement }) => ({
            providerSession: { secret: "never-public" },
            presentation: {
              kind: "uri",
              uri: "https://connector.example.test/private",
            },
            expiresAt: requirement.expiresAt,
          }),
          pollHandoff: async () => ({ status: "pending" }),
        },
      ],
    });
    const app = express();
    app.use(express.json({ limit: "256kb" }));
    app.use(
      createX424HttpRouter({
        service,
        providerRequests: profile.providerRequests,
        requirementStore: requirements,
        handoffService,
        resultAcceptanceStore: new InMemoryResultAcceptanceStore(),
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
    const { requirement } = (await created.json()) as {
      requirement: HumanRequirement;
    };
    const startedResponse = await fetch(
      `${base}/v1/requirements/${requirement.dependencyId}/handoffs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nonce: requirement.nonce,
          providerId: "world",
          methodId: "proof-of-human",
        }),
      },
    );
    expect(startedResponse.status).toBe(201);
    const started = (await startedResponse.json()) as {
      handoffId: string;
      accessToken: string;
    };
    expect(started.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const unauthorized = await fetch(
      `${base}/v1/handoffs/${started.handoffId}`,
      { headers: { authorization: `Bearer ${"Z".repeat(43)}` } },
    );
    expect(unauthorized.status).toBe(401);
    const pending = await fetch(`${base}/v1/handoffs/${started.handoffId}`, {
      headers: { authorization: `Bearer ${started.accessToken}` },
    });
    expect(pending.status).toBe(200);
    const pendingText = await pending.text();
    expect(pendingText).toContain('"status":"pending"');
    expect(pendingText).not.toContain("connector.example.test");
    expect(pendingText).not.toContain("never-public");

    const accept = (operationId: string) =>
      fetch(`${base}/v1/results/result-1/acceptances`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operationId,
          requestDigest: requirement.resource.requestDigest,
          expiresAt: requirement.expiresAt,
        }),
      });
    await expect((await accept("operation-1")).json()).resolves.toEqual({
      status: "new",
    });
    await expect((await accept("operation-1")).json()).resolves.toEqual({
      status: "same_operation",
    });
    await expect((await accept("operation-2")).json()).resolves.toEqual({
      status: "replay",
    });
  });
});
