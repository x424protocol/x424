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
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    expect(spec.openapi).toBe("3.1.0");
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
    expect(raw).toContain('"x424Transport"');
    expect(raw).toContain('"providerRequests"');
    expect(raw).not.toContain("providerSubject");
    expect(raw).not.toContain("nullifierHash");
    expect(raw).toMatch(
      /"x424Transport":\s*\{\s*"enum":\s*\["header",\s*"body"\]/,
    );
  });
});
