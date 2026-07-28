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
  InMemoryResultReplayStore,
  X424Service,
  createStaticBearerIssuanceAuthenticator,
  createWorldIdVerifierProfile,
  createX424HttpRouter,
  generatePairwiseSecret,
  generateResultKeyPair,
  worldIdProviderRequestFromRequirement,
  type HumanRequirement,
  type IssuancePrincipal,
  type RequirementStore,
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

  it("isolates authenticated state between tenants and bounds state expiry", async () => {
    const profile = createWorldIdVerifierProfile({
      appId: "app_test",
      rpId: "rp_test",
      action: "x424-test",
      environment: "staging",
      signingKeyHex: `0x${"34".repeat(32)}`,
      verifyRemote: async () => {
        throw new Error("not called");
      },
    });
    const tenantPrincipal = (
      issuer: string,
      subject: string,
    ): IssuancePrincipal => ({
      issuer,
      subject,
      allowedPurposes: ["test"],
      allowedAudiences: ["https://api.example.test"],
      allowedHttpMethods: ["POST"],
      allowedMethods: ["world:proof-of-human"],
      allowedResources: [
        {
          origin: "https://api.example.test",
          pathPrefix: "/action",
        },
      ],
    });
    const authenticator = createStaticBearerIssuanceAuthenticator({
      tenantA: tenantPrincipal("https://issuer-a.example", "shared-subject"),
      tenantB: tenantPrincipal("https://issuer-b.example", "shared-subject"),
    });
    const requirements = new InMemoryRequirementStore();
    const resultReplayStore = new InMemoryResultReplayStore();
    const resultAcceptanceStore = new InMemoryResultAcceptanceStore();
    const rateLimitKeys: string[] = [];
    const service = new X424Service({
      catalog: profile.catalog,
      adapters: [profile.adapter],
      nonceStore: new InMemoryNonceStore(),
      providerReplayStore: new InMemoryProviderReplayStore(),
      pairwiseSecret: generatePairwiseSecret(),
      resultSigner: generateResultKeyPair().signer,
    });
    const legacyBacking = new InMemoryRequirementStore();
    const legacyRequirements: RequirementStore = {
      put: (requirement) => legacyBacking.put(requirement),
      get: (dependencyId, now) => legacyBacking.get(dependencyId, now),
      delete: (dependencyId) => legacyBacking.delete(dependencyId),
    };
    expect(() =>
      createX424HttpRouter({
        service,
        providerRequests: profile.providerRequests,
        requirementStore: legacyRequirements,
        issuanceAuthenticator: authenticator,
        deploymentProfile: "dev-local-0.1",
      }),
    ).toThrow(/TenantIsolatedRequirementStore/);
    expect(() =>
      createX424HttpRouter({
        service,
        providerRequests: profile.providerRequests,
        requirementStore: requirements,
        resultReplayStore: {
          consume: async () => true,
        },
        issuanceAuthenticator: authenticator,
        deploymentProfile: "dev-local-0.1",
      }),
    ).toThrow(/LegacyAwareResultReplayStore/);
    expect(() =>
      createX424HttpRouter({
        service,
        providerRequests: profile.providerRequests,
        requirementStore: requirements,
        resultAcceptanceStore: {
          accept: async () => "new",
        },
        issuanceAuthenticator: authenticator,
        deploymentProfile: "dev-local-0.1",
      }),
    ).toThrow(/LegacyAwareResultAcceptanceStore/);
    const app = express();
    app.use(express.json({ limit: "256kb" }));
    app.use(
      createX424HttpRouter({
        service,
        providerRequests: profile.providerRequests,
        requirementStore: requirements,
        resultReplayStore,
        resultAcceptanceStore,
        issuanceAuthenticator: authenticator,
        rateLimiter: {
          consume: (key) => {
            rateLimitKeys.push(key);
            return {
              allowed: true,
              remaining: 99,
              resetAt: Date.now() + 60_000,
            };
          },
        },
        deploymentProfile: "dev-local-0.1",
      }),
    );
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    const authorization = (token: string) => ({
      authorization: `Bearer ${token}`,
    });

    const created = await fetch(`${base}/v1/requirements`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authorization("tenantA"),
      },
      body: JSON.stringify({
        purpose: "test",
        method: "POST",
        uri: "https://api.example.test/action",
        audience: "https://api.example.test",
        binding: { kind: "agent_key", value: "sha256:tenant-test" },
        accepts: profile.accepts,
      }),
    });
    expect(created.status).toBe(201);
    const { requirement } = (await created.json()) as {
      requirement: HumanRequirement;
    };
    const requirementUrl = `${base}/v1/requirements/${requirement.dependencyId}`;

    expect(
      (
        await fetch(requirementUrl, {
          headers: authorization("tenantB"),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(requirementUrl, {
          method: "DELETE",
          headers: authorization("tenantB"),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(requirementUrl, {
          headers: authorization("tenantA"),
        })
      ).status,
    ).toBe(200);

    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const legacyExpiresAt = new Date(
      Date.now() + 24 * 60 * 60 * 1_000,
    ).toISOString();
    await expect(
      resultReplayStore.consume("legacy-consumed", legacyExpiresAt),
    ).resolves.toBe(true);
    await expect(
      resultAcceptanceStore.accept({
        resultId: "legacy-acceptance",
        operationId: "legacy-operation",
        requestDigest: requirement.resource.requestDigest,
        expiresAt: legacyExpiresAt,
      }),
    ).resolves.toBe("new");
    const consume = (token: string, resultId: string, expiry = expiresAt) =>
      fetch(`${base}/v1/results/${resultId}/consume`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...authorization(token),
        },
        body: JSON.stringify({ expiresAt: expiry }),
      });
    await expect(
      (await consume("tenantA", "shared-result")).json(),
    ).resolves.toEqual({ consumed: true });
    await expect(
      (await consume("tenantB", "shared-result")).json(),
    ).resolves.toEqual({ consumed: true });
    await expect(
      (await consume("tenantA", "shared-result")).json(),
    ).resolves.toEqual({ consumed: false });
    await expect(
      (await consume("tenantA", "legacy-consumed")).json(),
    ).resolves.toEqual({ consumed: false });

    const accept = (
      token: string,
      operationId: string,
      resultId = "shared-acceptance",
      expiry = expiresAt,
    ) =>
      fetch(`${base}/v1/results/${resultId}/acceptances`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...authorization(token),
        },
        body: JSON.stringify({
          operationId,
          requestDigest: requirement.resource.requestDigest,
          expiresAt: expiry,
        }),
      });
    await expect(
      (await accept("tenantA", "operation-a")).json(),
    ).resolves.toEqual({ status: "new" });
    await expect(
      (await accept("tenantB", "operation-b")).json(),
    ).resolves.toEqual({ status: "new" });
    await expect(
      (await accept("tenantA", "other-operation", "legacy-acceptance")).json(),
    ).resolves.toEqual({ status: "replay" });
    await expect(
      (await accept("tenantA", "legacy-operation", "legacy-acceptance")).json(),
    ).resolves.toEqual({ status: "same_operation" });

    const tooFarInFuture = new Date(Date.now() + 3_600_000).toISOString();
    expect(
      (await consume("tenantA", "future-result", tooFarInFuture)).status,
    ).toBe(400);
    expect(
      (
        await accept(
          "tenantA",
          "future-operation",
          "future-acceptance",
          tooFarInFuture,
        )
      ).status,
    ).toBe(400);
    await expect(
      (await consume("tenantA", "future-result")).json(),
    ).resolves.toEqual({ consumed: true });
    await expect(
      (await accept("tenantA", "future-operation", "future-acceptance")).json(),
    ).resolves.toEqual({ status: "new" });

    expect(
      (
        await fetch(requirementUrl, {
          method: "DELETE",
          headers: authorization("tenantA"),
        })
      ).status,
    ).toBe(204);
    expect(rateLimitKeys).toEqual(
      expect.arrayContaining([
        expect.stringContaining("state:requirement-read:tenant:"),
        expect.stringContaining("state:requirement-delete:tenant:"),
        expect.stringContaining("state:result-consume:tenant:"),
        expect.stringContaining("state:result-accept:tenant:"),
      ]),
    );
    expect(rateLimitKeys.join("\n")).not.toContain("shared-subject");
    expect(rateLimitKeys.join("\n")).not.toContain("issuer-a");
    expect(rateLimitKeys.join("\n")).not.toContain("issuer-b");
  });
});
