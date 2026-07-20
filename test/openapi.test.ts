import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("OpenAPI contract", () => {
  it("publishes the implemented reference endpoints and privacy boundary", async () => {
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
      "/healthz",
      "/v1/requirements",
      "/v1/requirements/{dependencyId}/verify",
    ]);
    expect(spec.components.schemas.HumanResult).toBeTruthy();
    expect(raw).not.toContain("providerSubject");
    expect(raw).not.toContain("nullifierHash");
  });
});
