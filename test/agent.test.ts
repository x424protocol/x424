import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  createCallbackHandoffPresenter,
  createEd25519AgentKeyResolver,
  createEd25519AgentRequestSigner,
  createEvmAgentKeyResolver,
  createEvmAgentRequestSigner,
  createX424AgentClient,
  signX424AgentRequest,
  verifyX424AgentRequest,
} from "../src/agent.js";
import { createHumanRequirement, humanRequiredResponse } from "../src/core.js";

describe("agent HTTP message signatures", () => {
  it("binds Ed25519 possession to method, URI, body, proof, and dependency", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const signer = createEd25519AgentRequestSigner(privateKey);
    const resolver = createEd25519AgentKeyResolver(
      new Map([[signer.keyId, publicKey]]),
    );
    const signed = await signX424AgentRequest(
      new Request("https://api.example.test/action", {
        method: "POST",
        headers: { "human-proof": "signed-human-result" },
        body: JSON.stringify({ title: "exact" }),
      }),
      signer,
      { nonce: "x424_dependency_test", now: new Date("2026-07-20T12:00:00Z") },
    );
    await expect(
      verifyX424AgentRequest(signed, {
        resolveKey: resolver,
        expectedNonce: "x424_dependency_test",
        now: new Date("2026-07-20T12:00:30Z"),
      }),
    ).resolves.toEqual({ kind: "agent_key", value: signer.keyId });

    const substituted = new Request(signed, {
      headers: new Headers(signed.headers),
      body: JSON.stringify({ title: "changed" }),
    });
    await expect(
      verifyX424AgentRequest(substituted, {
        resolveKey: resolver,
        expectedNonce: "x424_dependency_test",
        now: new Date("2026-07-20T12:00:30Z"),
      }),
    ).rejects.toThrow(/Content-Digest/);
    await expect(
      verifyX424AgentRequest(signed, {
        resolveKey: resolver,
        expectedNonce: "different",
        now: new Date("2026-07-20T12:00:30Z"),
      }),
    ).rejects.toThrow(/nonce/);
    await expect(
      verifyX424AgentRequest(signed, {
        resolveKey: resolver,
        expectedNonce: "x424_dependency_test",
        now: new Date("2026-07-20T12:02:00Z"),
      }),
    ).rejects.toThrow(/time window/);

    const proofRemoved = new Request(signed, {
      headers: Object.fromEntries(
        [...signed.headers].filter(([name]) => name !== "human-proof"),
      ),
    });
    await expect(
      verifyX424AgentRequest(proofRemoved, {
        resolveKey: resolver,
        expectedNonce: "x424_dependency_test",
        now: new Date("2026-07-20T12:00:30Z"),
      }),
    ).rejects.toThrow(/required components/);
  });

  it("supports an EIP-191 CAIP-10 signer without changing x424 core", async () => {
    const account = privateKeyToAccount(
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    const signer = createEvmAgentRequestSigner({
      accountId: `eip155:1:${account.address}`,
      signMessage: (input) => account.signMessage(input),
    });
    const signed = await signX424AgentRequest(
      new Request("https://api.example.test/action"),
      signer,
      { now: new Date("2026-07-20T12:00:00Z") },
    );
    await expect(
      verifyX424AgentRequest(signed, {
        resolveKey: createEvmAgentKeyResolver(),
        now: new Date("2026-07-20T12:00:30Z"),
      }),
    ).resolves.toEqual({ kind: "agent_key", value: signer.keyId });
  });

  it("requires the ERC-1271 magic value for a CAIP-10 contract key", async () => {
    const accountId = "eip155:8453:0x1111111111111111111111111111111111111111";
    const signer = createEvmAgentRequestSigner({
      accountId,
      contractWallet: true,
      signMessage: async () => `0x${"ab".repeat(65)}`,
    });
    const signed = await signX424AgentRequest(
      new Request("https://api.example.test/action"),
      signer,
      { now: new Date("2026-07-20T12:00:00Z") },
    );
    const validClient = {
      readContract: vi.fn(async () => "0x1626ba7e"),
    };
    await expect(
      verifyX424AgentRequest(signed, {
        resolveKey: createEvmAgentKeyResolver({
          erc1271Clients: new Map([["8453", validClient]]),
        }),
        now: new Date("2026-07-20T12:00:30Z"),
      }),
    ).resolves.toEqual({ kind: "agent_key", value: accountId });
    expect(validClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: "0x1111111111111111111111111111111111111111",
        functionName: "isValidSignature",
      }),
    );

    await expect(
      verifyX424AgentRequest(signed, {
        resolveKey: createEvmAgentKeyResolver({
          erc1271Clients: new Map([
            ["8453", { readContract: async () => "0xffffffff" }],
          ]),
        }),
        now: new Date("2026-07-20T12:00:30Z"),
      }),
    ).rejects.toThrow(/signature is invalid/);
  });
});

describe("brokered x424 agent client", () => {
  it("signs 424, 402, and final retries while the agent never receives native proof", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const signer = createEd25519AgentRequestSigner(privateKey);
    const resolver = createEd25519AgentKeyResolver(
      new Map([[signer.keyId, publicKey]]),
    );
    const requirement = createHumanRequirement({
      purpose: "paid-action",
      method: "POST",
      uri: "https://api.example.test/action",
      audience: "https://api.example.test",
      body: { title: "exact" },
      binding: { kind: "agent_key", value: signer.keyId },
      accepts: [
        {
          providerId: "world",
          methodId: "proof-of-human",
          descriptorVersion: "2026-01",
          acceptedScopeKinds: ["action"],
        },
      ],
    });
    const challenge = humanRequiredResponse(requirement);
    const requests: Request[] = [];
    const fetchImplementation = vi.fn(async (request: Request) => {
      requests.push(request);
      if (!request.headers.has("human-proof")) {
        await verifyX424AgentRequest(request, { resolveKey: resolver });
        return Response.json(challenge.body, {
          status: 424,
          headers: challenge.headers,
        });
      }
      await verifyX424AgentRequest(request, {
        resolveKey: resolver,
        expectedNonce: requirement.dependencyId,
      });
      if (!request.headers.has("payment-signature")) {
        return new Response(null, {
          status: 402,
          headers: { "payment-required": "payment" },
        });
      }
      return new Response("ok", { status: 201 });
    });
    const events: unknown[] = [];
    const handoffClient = {
      startHandoff: vi.fn(async () => ({
        handoffId: "x424_handoff_test",
        accessToken: "A".repeat(43),
        status: "pending" as const,
        providerId: "world",
        methodId: "proof-of-human",
        presentation: {
          kind: "uri" as const,
          uri: "https://world.example/connect",
        },
        expiresAt: requirement.expiresAt,
        pollAfterMs: 500,
      })),
      getHandoff: vi.fn(async () => ({
        handoffId: "x424_handoff_test",
        status: "completed" as const,
        humanProof: "signed-human-result",
        expiresAt: requirement.expiresAt,
      })),
      cancelHandoff: vi.fn(async () => undefined),
    };
    const client = createX424AgentClient({
      signer,
      handoffClient,
      presenter: createCallbackHandoffPresenter((event) => {
        events.push(event);
      }),
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
      resolvePaymentDependency: async () => ({
        paymentSignature: "signed-payment",
      }),
    });
    const response = await client.fetch("https://api.example.test/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "exact" }),
    });
    expect(response.status).toBe(201);
    expect(requests).toHaveLength(3);
    expect(
      requests.every((request) => request.headers.has("idempotency-key")),
    ).toBe(true);
    expect(events).toMatchObject([
      { type: "human_action_required" },
      { type: "completed" },
    ]);
    expect(JSON.stringify(events)).not.toContain("nativeProof");
  });
});
