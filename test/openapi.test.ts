import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("OpenAPI contract", () => {
  it("publishes the self-hosted and managed runtime contract and privacy boundary", async () => {
    const raw = await readFile(
      new URL("../openapi/x424.openapi.json", import.meta.url),
      "utf8",
    );
    const spec = JSON.parse(raw) as {
      openapi: string;
      info: { version: string };
      paths: Record<
        string,
        {
          get?: {
            responses?: Record<
              string,
              { headers?: Record<string, unknown>; content?: unknown }
            >;
          };
          post?: { security?: readonly Record<string, readonly string[]>[] };
          delete?: { responses?: Record<string, unknown> };
        }
      >;
      components: { schemas: Record<string, unknown> };
    };
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.version).toBe("0.1.4");
    expect(Object.keys(spec.paths).sort()).toEqual([
      "/.well-known/x424-verifier",
      "/healthz",
      "/v1/handoffs/{handoffId}",
      "/v1/requirements",
      "/v1/requirements/{dependencyId}",
      "/v1/requirements/{dependencyId}/handoffs",
      "/v1/requirements/{dependencyId}/verify",
      "/v1/results/{resultId}/acceptances",
      "/v1/results/{resultId}/consume",
    ]);
    expect(spec.components.schemas.HumanResult).toBeTruthy();
    expect(spec.components.schemas.RequestBodyDigestInput).toBeTruthy();
    expect(spec.components.schemas.HumanRequiredProblem).toBeTruthy();
    expect(spec.components.schemas.HumanHandoff).toBeTruthy();
    expect(spec.components.schemas.ResultAcceptance).toBeTruthy();
    expect(
      spec.paths["/v1/requirements/{dependencyId}/verify"]?.post?.security,
    ).toEqual([]);
    expect(
      spec.paths["/v1/requirements/{dependencyId}"]?.delete?.responses?.["404"],
    ).toBeTruthy();
    const metadataResponses =
      spec.paths["/.well-known/x424-verifier"]?.get?.responses;
    expect(Object.keys(metadataResponses ?? {}).sort()).toEqual([
      "200",
      "401",
      "429",
      "503",
    ]);
    for (const status of ["200", "401", "429"] as const) {
      expect(metadataResponses?.[status]?.headers).toHaveProperty(
        "Cache-Control",
      );
      expect(metadataResponses?.[status]?.headers).toHaveProperty("Vary");
      expect(metadataResponses?.[status]?.headers).toHaveProperty(
        "X-RateLimit-Remaining",
      );
    }
    expect(metadataResponses?.["401"]?.headers).toHaveProperty(
      "WWW-Authenticate",
    );
    expect(metadataResponses?.["429"]?.headers).toHaveProperty("Retry-After");
    expect(metadataResponses?.["503"]?.headers).toHaveProperty("Cache-Control");
    expect(metadataResponses?.["503"]?.headers).toHaveProperty("Vary");
    expect(metadataResponses?.["503"]?.headers).not.toHaveProperty(
      "X-RateLimit-Remaining",
    );
    for (const status of ["401", "429", "503"] as const) {
      expect(metadataResponses?.[status]?.content).toBeTruthy();
    }
    expect(raw).toContain('"x424Transport"');
    expect(raw).toContain('"providerRequests"');
    expect(raw).not.toContain("providerSubject");
    expect(raw).not.toContain("nullifierHash");
    expect(raw).toMatch(
      /"x424Transport":\s*\{\s*"enum":\s*\["header",\s*"body"\]/,
    );
  });
});
