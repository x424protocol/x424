import { describe, expect, it, vi } from "vitest";
import {
  HUMAN_PROOF_HEADER,
  InMemoryRequirementStore,
  InMemoryResultAcceptanceStore,
  InMemoryResultReplayStore,
  composeFetchX424BeforeX402,
  createOfficialX402PaymentResolver,
  createHumanRequirement,
  defineHumanMethodDescriptor,
  defineMethodCatalog,
  fetchWithX424AndX402,
  generateResultKeyPair,
  humanRequiredResponse,
  sha256,
  signHumanResult,
} from "../src/index.js";
import { protectFetchResource } from "../src/middleware/resource.js";

function challenge() {
  return humanRequiredResponse(
    createHumanRequirement({
      purpose: "paid-record",
      method: "POST",
      uri: "https://api.example.test/records",
      audience: "https://api.example.test",
      body: { title: "Hello" },
      binding: { kind: "agent_key", value: "sha256:agent" },
      accepts: [
        {
          providerId: "example",
          methodId: "unique-human",
          descriptorVersion: "1",
          acceptedScopeKinds: ["relying_party"],
        },
      ],
    }),
  );
}

describe("x424 before x402", () => {
  it("adapts current official x402 client objects", async () => {
    const processPaymentResult = vi.fn(async () => ({ recovered: false }));
    const resolver = createOfficialX402PaymentResolver({
      client: {
        createPaymentPayload: async (required) => ({ required }),
      },
      httpClient: {
        getPaymentRequiredResponse: (getHeader) => ({
          encoded: getHeader("payment-required"),
        }),
        encodePaymentSignatureHeader: () => ({
          "PAYMENT-SIGNATURE": "official-signature",
        }),
        processPaymentResult,
      },
    });
    const resolved = await resolver({
      request: new Request("https://api.example.test/records"),
      response: new Response(null, {
        status: 402,
        headers: { "payment-required": "official-required" },
      }),
    });
    expect(resolved.paymentSignature).toBe("official-signature");
    await resolved.processResponse?.(new Response(null, { status: 201 }));
    expect(processPaymentResult).toHaveBeenCalledOnce();
  });

  it("never evaluates payment when humanity returns a challenge", async () => {
    const payment = vi.fn(async () => new Response(null, { status: 402 }));
    const composed = composeFetchX424BeforeX402(
      async () => new Response(null, { status: 424 }),
      payment,
    );
    const response = await composed(
      new Request("https://api.example.test/records"),
    );
    expect(response?.status).toBe(424);
    expect(payment).not.toHaveBeenCalled();
  });

  it("uses 424, then 402, then a final request with separate proofs", async () => {
    const required = challenge();
    const requests: Request[] = [];
    const fetchImplementation = vi.fn(async (request: Request) => {
      requests.push(request);
      if (!request.headers.has(HUMAN_PROOF_HEADER)) {
        return Response.json(required.body, {
          status: 424,
          headers: required.headers,
        });
      }
      if (!request.headers.has("payment-signature")) {
        return new Response(null, {
          status: 402,
          headers: { "payment-required": "x402-challenge" },
        });
      }
      return new Response("created", { status: 201 });
    });
    const response = await fetchWithX424AndX402(
      "https://api.example.test/records",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "operation-1",
        },
        body: JSON.stringify({ title: "Hello" }),
      },
      {
        fetchImplementation: fetchImplementation as unknown as typeof fetch,
        resolveHumanDependency: async () => ({ humanProof: "human-token" }),
        resolvePaymentDependency: async ({ response }) => {
          expect(response.headers.get("payment-required")).toBe(
            "x402-challenge",
          );
          return { paymentSignature: "payment-token" };
        },
      },
    );

    expect(response.status).toBe(201);
    expect(requests).toHaveLength(3);
    expect(requests[0]!.headers.get(HUMAN_PROOF_HEADER)).toBeNull();
    expect(requests[1]!.headers.get(HUMAN_PROOF_HEADER)).toBe("human-token");
    expect(requests[1]!.headers.get("payment-signature")).toBeNull();
    expect(requests[2]!.headers.get(HUMAN_PROOF_HEADER)).toBe("human-token");
    expect(requests[2]!.headers.get("payment-signature")).toBe("payment-token");
    expect(await requests[2]!.text()).toBe(JSON.stringify({ title: "Hello" }));
  });

  it("accepts the same human result across a real x424 then x402 server flow", async () => {
    const descriptor = defineHumanMethodDescriptor({
      providerId: "example",
      methodId: "unique-human",
      version: "1",
      status: "enabled",
      claim: "Example unique human",
      nonClaims: ["Authorization"],
      assuranceLevels: [],
      nativeScopeKinds: ["relying_party"],
      verificationModes: ["backend"],
      pairwisePseudonym: true,
      replaySemantics: "single-use",
      recoverySemantics: "provider-defined",
      privacy: "pairwise",
    });
    const keys = generateResultKeyPair();
    const requirementStore = new InMemoryRequirementStore();
    const resultAcceptanceStore = new InMemoryResultAcceptanceStore();
    const options = {
      deploymentProfile: "dev-local-0.1" as const,
      purpose: "paid-record",
      audience: "https://api.example.test",
      accepts: [
        {
          providerId: descriptor.providerId,
          methodId: descriptor.methodId,
          descriptorVersion: descriptor.version,
          acceptedScopeKinds: ["relying_party" as const],
        },
      ],
      catalog: defineMethodCatalog([descriptor]),
      verifier: keys.verifier,
      extractBinding: async () => ({
        kind: "agent_key" as const,
        value: "sha256:agent",
      }),
      requirementStore,
      replayStore: new InMemoryResultReplayStore(),
      resultAcceptanceStore,
      publicOrigin: { publicOrigin: "https://api.example.test" },
      requireIdempotencyKey: true,
      bodyInput: { kind: "json" as const, value: { title: "Hello" } },
    };
    const serverFetch = async (request: Request): Promise<Response> => {
      const protectedResult = await protectFetchResource(request, options);
      if (protectedResult.response) return protectedResult.response;
      if (!request.headers.has("payment-signature")) {
        return new Response(null, {
          status: 402,
          headers: { "payment-required": "x402-challenge" },
        });
      }
      return new Response("created", { status: 201 });
    };

    const response = await fetchWithX424AndX402(
      "https://api.example.test/records",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "operation-real-server",
        },
        body: JSON.stringify({ title: "Hello" }),
      },
      {
        fetchImplementation: serverFetch as typeof fetch,
        resolveHumanDependency: async ({ requirement }) => ({
          humanProof: signHumanResult(
            {
              x424Version: "0.1",
              resultId: "x424_result_real_x402",
              dependencyId: requirement.dependencyId,
              satisfied: true,
              purpose: requirement.purpose,
              audience: requirement.resource.audience,
              requestDigest: requirement.resource.requestDigest,
              binding: requirement.binding,
              providerId: descriptor.providerId,
              methodId: descriptor.methodId,
              descriptorVersion: descriptor.version,
              pairwiseHumanId: "x424_human_real_x402",
              uniquenessScope: {
                kind: "relying_party",
                id: "example:rp",
              },
              verificationMode: "backend",
              proofDigest: sha256("proof"),
              claim: descriptor.claim,
              nonClaims: descriptor.nonClaims,
              verifiedAt: requirement.createdAt,
              issuedAt: requirement.createdAt,
              expiresAt: requirement.expiresAt,
            },
            keys.signer,
          ),
        }),
        resolvePaymentDependency: async () => ({
          paymentSignature: "payment-token",
        }),
      },
    );

    expect(response.status).toBe(201);
    await expect(
      resultAcceptanceStore.accept({
        resultId: "x424_result_real_x402",
        operationId: "different-operation",
        requestDigest: "sha256:different",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).resolves.toBe("replay");
  });

  it("fails when a server evaluates payment before humanity", async () => {
    const fetchImplementation = vi.fn(
      async () => new Response(null, { status: 402 }),
    );
    await expect(
      fetchWithX424AndX402(
        "https://api.example.test/records",
        { method: "POST", body: "body" },
        {
          fetchImplementation: fetchImplementation as unknown as typeof fetch,
          resolveHumanDependency: async () => ({ humanProof: "human-token" }),
          resolvePaymentDependency: async () => ({
            paymentSignature: "payment-token",
          }),
        },
      ),
    ).rejects.toThrow("before the x424 dependency");
  });
});
