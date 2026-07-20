import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import {
  InMemoryNonceStore,
  WorldIdAdapter,
  X424Service,
  createX424HttpRouter,
  defineMethodCatalog,
  generatePairwiseSecret,
  generateResultKeyPair,
} from "../src/index.js";

describe("reference HTTP API", () => {
  const servers: Array<{ close(): void }> = [];

  afterEach(() => servers.splice(0).forEach((server) => server.close()));

  it("issues, verifies, and returns a private signed result", async () => {
    const adapter = new WorldIdAdapter({
      rpId: "rp_test",
      action: "x424-test",
      environment: "staging",
      validateBinding: async () => true,
      verifyRemote: async () => ({
        success: true,
        nullifier: "0xnever-public",
        created_at: new Date().toISOString(),
      }),
    });
    const service = new X424Service({
      catalog: defineMethodCatalog(adapter.methods()),
      adapters: [adapter],
      nonceStore: new InMemoryNonceStore(),
      pairwiseSecret: generatePairwiseSecret(),
      resultSigner: generateResultKeyPair().signer,
    });
    const app = express();
    app.use(express.json({ limit: "256kb" }));
    app.use(
      createX424HttpRouter({
        service,
        providerRequests: async () => ({
          "world:world-id-4-orb": {
            rpId: "rp_test",
            action: "x424-test",
            signedRequest: "opaque",
          },
        }),
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
        accepts: [
          {
            providerId: "world",
            methodId: "world-id-4-orb",
            descriptorVersion: "1",
            assuranceLevel: "orb",
            acceptedScopeKinds: ["action"],
            verificationModes: ["backend"],
          },
        ],
      }),
    });
    expect(created.status).toBe(201);
    expect(created.headers.get("human-required")).toBeTruthy();
    const createdBody = (await created.json()) as {
      requirement: {
        dependencyId: string;
        binding: { kind: "agent_key"; value: string };
      };
    };

    const verified = await fetch(
      `${base}/v1/requirements/${createdBody.requirement.dependencyId}/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          x424Version: "0.1",
          dependencyId: createdBody.requirement.dependencyId,
          providerId: "world",
          methodId: "world-id-4-orb",
          binding: createdBody.requirement.binding,
          nativeProof: { protocol_version: "4.0", proof: "opaque" },
        }),
      },
    );
    expect(verified.status).toBe(200);
    expect(verified.headers.get("human-result")).toMatch(/^ey/);
    const verifiedText = await verified.text();
    expect(verifiedText).not.toContain("never-public");
    expect(verifiedText).toContain("x424_human_");
  });
});
