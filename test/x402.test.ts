import { describe, expect, it, vi } from "vitest";
import {
  HUMAN_PROOF_HEADER,
  composeFetchX424BeforeX402,
  createOfficialX402PaymentResolver,
  createHumanRequirement,
  fetchWithX424AndX402,
  humanRequiredResponse,
} from "../src/index.js";

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
