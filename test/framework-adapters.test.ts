import type { AddressInfo } from "node:net";
import express, {
  type Request as ExpressRequest,
  type Response as ExpressResponse,
} from "express";
import { describe, expect, it } from "vitest";
import {
  InMemoryRequirementStore,
  InMemoryResultAcceptanceStore,
  InMemoryResultReplayStore,
  defineHumanMethodDescriptor,
  defineMethodCatalog,
  decodeHumanRequirement,
  generateResultKeyPair,
  sha256,
  signHumanResult,
  type HumanResult,
} from "../src/core.js";
import { createFetchX424Handler } from "../src/fetch.js";
import { createExpressHumanDependencyMiddleware } from "../src/middleware/resource.js";
import { createNextX424Handler } from "../src/next.js";

const descriptor = defineHumanMethodDescriptor({
  providerId: "example",
  methodId: "unique-human",
  version: "1",
  status: "enabled",
  claim: "Example unique human",
  nonClaims: ["Authorization"],
  assuranceLevels: ["standard"],
  nativeScopeKinds: ["relying_party"],
  verificationModes: ["backend"],
  pairwisePseudonym: true,
  replaySemantics: "single use",
  recoverySemantics: "provider defined",
  privacy: "pairwise",
});

function options(keys = generateResultKeyPair()) {
  return {
    deploymentProfile: "dev-local-0.1" as const,
    purpose: "publish-record",
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
    requirementStore: new InMemoryRequirementStore(),
    replayStore: new InMemoryResultReplayStore(),
    resultAcceptanceStore: new InMemoryResultAcceptanceStore(),
    publicOrigin: { publicOrigin: "https://api.example.test" },
    requireIdempotencyKey: false,
  };
}

async function callProtectedExpressRoute(
  configureResponse: (
    request: ExpressRequest,
    response: ExpressResponse,
  ) => void,
  resultSuffix: string,
): Promise<Response> {
  const keys = generateResultKeyPair();
  const app = express();
  app.get(
    "/records",
    createExpressHumanDependencyMiddleware(options(keys)),
    configureResponse,
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const { port } = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/records`;
    const challenge = await fetch(url);
    const requirement = decodeHumanRequirement(
      challenge.headers.get("human-required")!,
    );
    const result: HumanResult = {
      x424Version: "0.1",
      resultId: `x424_result_cache_express_${resultSuffix}`,
      dependencyId: requirement.dependencyId,
      satisfied: true,
      purpose: requirement.purpose,
      audience: requirement.resource.audience,
      requestDigest: requirement.resource.requestDigest,
      binding: requirement.binding,
      providerId: descriptor.providerId,
      methodId: descriptor.methodId,
      descriptorVersion: descriptor.version,
      assuranceLevel: "standard",
      pairwiseHumanId: `x424_human_cache_express_${resultSuffix}`,
      uniquenessScope: { kind: "relying_party", id: "example:rp" },
      verificationMode: "backend",
      proofDigest: sha256("proof"),
      claim: descriptor.claim,
      nonClaims: descriptor.nonClaims,
      verifiedAt: requirement.createdAt,
      issuedAt: requirement.createdAt,
      expiresAt: requirement.expiresAt,
    };
    const response = await fetch(url, {
      headers: { "human-proof": signHumanResult(result, keys.signer) },
    });
    await response.arrayBuffer();
    return response;
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("framework resource adapters", () => {
  it("gives Fetch and Next.js identical exact-body challenges", async () => {
    const body = JSON.stringify({ title: "exact bytes" });
    const fetchHandler = createFetchX424Handler(options(), async () =>
      Response.json({ ok: true }),
    );
    const nextHandler = createNextX424Handler(options(), async () =>
      Response.json({ ok: true }),
    );
    const init = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    };
    const fetchResponse = await fetchHandler(
      new Request("https://api.example.test/records", init),
    );
    const nextResponse = await nextHandler(
      new Request("https://api.example.test/records", init),
      {},
    );
    const fetchRequirement = decodeHumanRequirement(
      fetchResponse.headers.get("human-required")!,
    );
    const nextRequirement = decodeHumanRequirement(
      nextResponse.headers.get("human-required")!,
    );
    expect(fetchResponse.status).toBe(424);
    expect(nextResponse.status).toBe(424);
    expect(fetchRequirement.resource.requestDigest).toBe(
      nextRequirement.resource.requestDigest,
    );
  });

  it("makes successful Fetch and Next.js responses private and non-cacheable", async () => {
    for (const framework of ["fetch", "next"] as const) {
      const keys = generateResultKeyPair();
      const handlerOptions = options(keys);
      const applicationHandler = async () =>
        new Response("protected", {
          headers: {
            "cache-control": "public, max-age=3600",
            vary: "Accept-Encoding",
          },
        });
      let call: (request: Request) => Promise<Response>;
      if (framework === "fetch") {
        const handler = createFetchX424Handler(
          handlerOptions,
          applicationHandler,
        );
        call = (request) => handler(request);
      } else {
        const handler = createNextX424Handler(handlerOptions, async () =>
          applicationHandler(),
        );
        call = (request) => handler(request, {});
      }
      const challenge = await call(
        new Request("https://api.example.test/records"),
      );
      const requirement = decodeHumanRequirement(
        challenge.headers.get("human-required")!,
      );
      const result: HumanResult = {
        x424Version: "0.1",
        resultId: `x424_result_cache_${framework}`,
        dependencyId: requirement.dependencyId,
        satisfied: true,
        purpose: requirement.purpose,
        audience: requirement.resource.audience,
        requestDigest: requirement.resource.requestDigest,
        binding: requirement.binding,
        providerId: descriptor.providerId,
        methodId: descriptor.methodId,
        descriptorVersion: descriptor.version,
        assuranceLevel: "standard",
        pairwiseHumanId: `x424_human_cache_${framework}`,
        uniquenessScope: { kind: "relying_party", id: "example:rp" },
        verificationMode: "backend",
        proofDigest: sha256("proof"),
        claim: descriptor.claim,
        nonClaims: descriptor.nonClaims,
        verifiedAt: requirement.createdAt,
        issuedAt: requirement.createdAt,
        expiresAt: requirement.expiresAt,
      };
      const response = await call(
        new Request("https://api.example.test/records", {
          headers: { "human-proof": signHumanResult(result, keys.signer) },
        }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("vary")?.toLowerCase()).toContain(
        "human-proof",
      );
      expect(response.headers.get("vary")?.toLowerCase()).toContain(
        "accept-encoding",
      );
    }
  });

  it("prevents an Express route from removing protected cache headers", async () => {
    const response = await callProtectedExpressRoute((_request, response) => {
      response.setHeader("cache-control", "public, max-age=3600");
      response.setHeader("vary", "Accept-Encoding");
      response.removeHeader("cache-control");
      response.removeHeader("vary");
      expect(response.getHeader("cache-control")).toBe("private, no-store");
      expect(String(response.getHeader("vary")).toLowerCase()).toContain(
        "human-proof",
      );
      response.status(200).send("protected");
    }, "remove");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")?.toLowerCase()).toContain(
      "human-proof",
    );
    expect(response.headers.get("vary")?.toLowerCase()).toContain(
      "accept-encoding",
    );
  });

  it("sanitizes cache headers passed directly to Express writeHead", async () => {
    const response = await callProtectedExpressRoute((_request, response) => {
      response.writeHead(200, {
        "cache-control": "public, max-age=3600",
        vary: "Accept-Encoding",
      });
      response.end("protected");
    }, "write_head");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")?.toLowerCase()).toContain(
      "human-proof",
    );
    expect(response.headers.get("vary")?.toLowerCase()).toContain(
      "accept-encoding",
    );
  });
});
