import { describe, expect, it, vi } from "vitest";
import {
  HUMAN_PROOF_HEADER,
  createHumanRequirement,
  createHttpHumanDependencyResolver,
  fetchWithX424,
  humanRequiredResponse,
} from "../src/core.js";

function requirement() {
  return createHumanRequirement({
    purpose: "publish-record",
    method: "POST",
    uri: "https://api.example.test/records",
    audience: "https://api.example.test",
    body: { title: "Hello" },
    binding: { kind: "agent_key", value: "sha256:agent-key" },
    accepts: [
      {
        providerId: "example",
        methodId: "unique-human",
        descriptorVersion: "1",
        acceptedScopeKinds: ["relying_party"],
      },
    ],
  });
}

describe("x424 fetch client", () => {
  it("resolves one human dependency and retries the exact request", async () => {
    const challenge = humanRequiredResponse(requirement());
    const requests: Request[] = [];
    const fetchImplementation = vi.fn(async (request: Request) => {
      requests.push(request);
      if (!request.headers.has(HUMAN_PROOF_HEADER)) {
        return new Response(JSON.stringify(challenge.body), {
          status: challenge.status,
          headers: challenge.headers,
        });
      }
      return new Response("created", { status: 201 });
    });
    const resolveHumanDependency = vi.fn(async () => ({
      humanProof: "signed-result-token",
    }));

    const response = await fetchWithX424(
      "https://api.example.test/records",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Hello" }),
      },
      {
        fetchImplementation: fetchImplementation as unknown as typeof fetch,
        resolveHumanDependency,
      },
    );

    expect(response.status).toBe(201);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(resolveHumanDependency).toHaveBeenCalledTimes(1);
    expect(requests[1]!.headers.get(HUMAN_PROOF_HEADER)).toBe(
      "signed-result-token",
    );
    expect(await requests[1]!.text()).toBe(JSON.stringify({ title: "Hello" }));
  });

  it("does not reinterpret an ordinary 424 response as x424", async () => {
    const fetchImplementation = vi.fn(
      async () => new Response("ordinary dependency", { status: 424 }),
    );
    const resolveHumanDependency = vi.fn(async () => ({ humanProof: "proof" }));

    const response = await fetchWithX424(
      "https://api.example.test/records",
      undefined,
      {
        fetchImplementation: fetchImplementation as unknown as typeof fetch,
        resolveHumanDependency,
      },
    );

    expect(response.status).toBe(424);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(resolveHumanDependency).not.toHaveBeenCalled();
  });

  it("rejects a challenge for another request before human handoff", async () => {
    const other = humanRequiredResponse(
      createHumanRequirement({
        purpose: "other",
        method: "POST",
        uri: "https://api.example.test/other",
        audience: "https://api.example.test",
        binding: { kind: "agent_key", value: "sha256:agent-key" },
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
    const fetchImplementation = vi.fn(
      async () =>
        new Response(JSON.stringify(other.body), {
          status: other.status,
          headers: other.headers,
        }),
    );
    const resolveHumanDependency = vi.fn(async () => ({ humanProof: "proof" }));

    await expect(
      fetchWithX424(
        "https://api.example.test/records",
        { method: "POST" },
        {
          fetchImplementation: fetchImplementation as unknown as typeof fetch,
          resolveHumanDependency,
        },
      ),
    ).rejects.toThrow("another HTTP request");
    expect(resolveHumanDependency).not.toHaveBeenCalled();
  });

  it("submits provider proof through the standard verifier API", async () => {
    const requests: Request[] = [];
    const fetchImplementation = vi.fn(async (request: Request) => {
      requests.push(request);
      return new Response(JSON.stringify({ token: "signed-result-token" }), {
        status: 200,
        headers: { "human-result": "signed-result-token" },
      });
    });
    const resolver = createHttpHumanDependencyResolver({
      verifierUrl: "https://verifier.example.test/x424/",
      resolveProviderProof: async () => ({
        providerId: "example",
        methodId: "unique-human",
        descriptorVersion: "1",
        nativeProof: { opaque: true },
      }),
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
      headers: { authorization: "Bearer verifier-token" },
      allowHttpLocalhost: false,
    });

    await expect(
      resolver({
        requirement: requirement(),
        response: new Response(null, { status: 424 }),
      }),
    ).resolves.toEqual({ humanProof: "signed-result-token" });
    expect(requests[0]!.url).toContain("/x424/v1/requirements/x424_dep_");
    expect(requests[0]!.headers.get("authorization")).toBe(
      "Bearer verifier-token",
    );
    const submitted = (await requests[0]!.json()) as {
      providerId: string;
      binding: { value: string };
    };
    expect(submitted.providerId).toBe("example");
    expect(submitted.binding.value).toBe("sha256:agent-key");
  });

  it("rejects a resolver for another descriptor version before submission", async () => {
    const fetchImplementation = vi.fn();
    const resolver = createHttpHumanDependencyResolver({
      verifierUrl: "https://verifier.example.test/",
      resolveProviderProof: async () => ({
        providerId: "example",
        methodId: "unique-human",
        descriptorVersion: "2",
        nativeProof: { opaque: true },
      }),
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
    });

    await expect(
      resolver({
        requirement: requirement(),
        response: new Response(null, { status: 424 }),
      }),
    ).rejects.toThrow("unaccepted human method");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
