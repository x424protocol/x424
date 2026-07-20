import { describe, expect, it, vi } from "vitest";
import {
  ManagedVerifierClient,
  createHumanRequirement,
  type HumanRequirement,
} from "../src/index.js";

function requirement(): HumanRequirement {
  return createHumanRequirement({
    purpose: "publish-record",
    method: "POST",
    uri: "https://api.example.test/records",
    audience: "https://api.example.test",
    bodyInput: { kind: "opaque", bytes: new TextEncoder().encode("hello") },
    binding: { kind: "agent_key", value: "sha256:agent" },
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

describe("managed verifier client", () => {
  it("issues, reads, deletes, and consumes through one pinned origin", async () => {
    const issued = requirement();
    const requests: Request[] = [];
    const fetchImplementation = vi.fn(async (request: Request) => {
      requests.push(request);
      if (request.url.includes("/.well-known/x424-verifier")) {
        return Response.json({ token: "signed-metadata" });
      }
      if (
        request.url.endsWith("/v1/requirements") &&
        request.method === "POST"
      ) {
        return Response.json({ requirement: issued }, { status: 201 });
      }
      if (request.url.includes("/v1/results/")) {
        return Response.json({ consumed: true });
      }
      if (request.method === "DELETE")
        return new Response(null, { status: 204 });
      return Response.json({ requirement: issued });
    });
    const client = new ManagedVerifierClient({
      baseUrl: "https://managed.example.test/tenant/",
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
      headers: async () => ({ authorization: "Bearer project-token" }),
    });

    await expect(
      client.issueRequirement({
        purpose: issued.purpose,
        method: issued.resource.method,
        uri: issued.resource.uri,
        audience: issued.resource.audience,
        bodyInput: {
          kind: "opaque",
          bytes: new TextEncoder().encode("hello"),
        },
        binding: issued.binding,
        accepts: issued.accepts,
        ttlSeconds: 300,
      }),
    ).resolves.toEqual(issued);
    await expect(client.getRequirement(issued.dependencyId)).resolves.toEqual(
      issued,
    );
    await expect(
      client.consumeResult("x424_result_test", issued.expiresAt),
    ).resolves.toBe(true);
    await expect(client.deleteRequirement(issued.dependencyId)).resolves.toBe(
      undefined,
    );
    await expect(client.getMetadataToken()).resolves.toBe("signed-metadata");

    expect(requests).toHaveLength(5);
    expect(requests.every((request) => request.redirect === "manual")).toBe(
      true,
    );
    expect(requests[0]!.headers.get("authorization")).toBe(
      "Bearer project-token",
    );
    const issuance = (await requests[0]!.json()) as {
      bodyInput: { kind: string; bytesBase64url: string };
    };
    expect(issuance.bodyInput).toEqual({
      kind: "opaque",
      bytesBase64url: "aGVsbG8",
    });
  });

  it("rejects redirects without resending credentials", async () => {
    const fetchImplementation = vi.fn(
      async () =>
        new Response(null, {
          status: 307,
          headers: { location: "https://evil.example/collect" },
        }),
    );
    const client = new ManagedVerifierClient({
      baseUrl: "https://managed.example.test/",
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
      headers: { authorization: "Bearer secret" },
    });
    await expect(client.getRequirement("dep")).rejects.toThrow("redirects");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("bounds remote state responses while streaming", async () => {
    const client = new ManagedVerifierClient({
      baseUrl: "https://managed.example.test/",
      fetchImplementation: (async () =>
        new Response("x".repeat(1_048_577), {
          status: 200,
        })) as typeof fetch,
    });
    await expect(client.getRequirement("dep")).rejects.toThrow("too large");
  });
});
