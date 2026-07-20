import { describe, expect, it } from "vitest";
import {
  POSTGRES_X424_SCHEMA_SQL,
  PostgresX424Store,
  createHumanRequirement,
} from "../src/core.js";

class MemoryPg {
  nonces = new Map<string, { nonce: string; expiresAt: string }>();
  requirements = new Map<string, { document: string; expiresAt: string }>();
  providers = new Set<string>();
  results = new Set<string>();

  async query(text: string, params: unknown[] = []) {
    if (text.includes("CREATE TABLE")) {
      return { rowCount: 0, rows: [] };
    }
    if (text.includes("INSERT INTO x424_nonces")) {
      if (this.nonces.has(String(params[0]))) {
        return { rowCount: 0, rows: [] };
      }
      this.nonces.set(String(params[0]), {
        nonce: String(params[1]),
        expiresAt: String(params[2]),
      });
      return { rowCount: 1, rows: [] };
    }
    if (text.includes("DELETE FROM x424_nonces")) {
      const entry = this.nonces.get(String(params[0]));
      if (
        entry &&
        entry.nonce === params[1] &&
        Date.parse(entry.expiresAt) > Date.now()
      ) {
        this.nonces.delete(String(params[0]));
        return { rowCount: 1, rows: [{ dependency_id: params[0] }] };
      }
      return { rowCount: 0, rows: [] };
    }
    if (text.includes("INSERT INTO x424_requirements")) {
      if (this.requirements.has(String(params[0]))) {
        return { rowCount: 0, rows: [] };
      }
      this.requirements.set(String(params[0]), {
        document: String(params[1]),
        expiresAt: String(params[2]),
      });
      return { rowCount: 1, rows: [] };
    }
    if (text.includes("SELECT document")) {
      const entry = this.requirements.get(String(params[0]));
      if (!entry) return { rowCount: 0, rows: [] };
      return {
        rowCount: 1,
        rows: [
          {
            document: JSON.parse(entry.document),
            expires_at: entry.expiresAt,
          },
        ],
      };
    }
    if (text.includes("DELETE FROM x424_requirements")) {
      this.requirements.delete(String(params[0]));
      return { rowCount: 1, rows: [] };
    }
    if (text.includes("INSERT INTO x424_provider_subjects")) {
      if (this.providers.has(String(params[0]))) {
        return { rowCount: 0, rows: [] };
      }
      this.providers.add(String(params[0]));
      return { rowCount: 1, rows: [{ digest: params[0] }] };
    }
    if (text.includes("INSERT INTO x424_results")) {
      if (this.results.has(String(params[0]))) {
        return { rowCount: 0, rows: [] };
      }
      this.results.add(String(params[0]));
      return { rowCount: 1, rows: [{ result_id: params[0] }] };
    }
    return { rowCount: 0, rows: [] };
  }
}

describe("PostgresX424Store", () => {
  it("exposes idempotent schema SQL", () => {
    expect(POSTGRES_X424_SCHEMA_SQL).toContain("x424_nonces");
    expect(POSTGRES_X424_SCHEMA_SQL).toContain("IF NOT EXISTS");
  });

  it("atomically consumes nonces and results", async () => {
    const pg = new MemoryPg();
    const store = new PostgresX424Store({ client: pg });
    await store.migrate();
    const requirement = createHumanRequirement({
      purpose: "publish-record",
      method: "POST",
      uri: "https://api.example.test/records",
      audience: "https://api.example.test",
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
    await store.requirements.put(requirement);
    await store.nonces.put(
      requirement.dependencyId,
      requirement.nonce,
      requirement.expiresAt,
    );
    await expect(store.requirements.put(requirement)).rejects.toThrow(
      "already exists",
    );
    await expect(
      store.nonces.put(
        requirement.dependencyId,
        "replacement",
        requirement.expiresAt,
      ),
    ).rejects.toThrow("already exists");
    expect(
      await store.nonces.consume(requirement.dependencyId, requirement.nonce),
    ).toBe(true);
    expect(
      await store.nonces.consume(requirement.dependencyId, requirement.nonce),
    ).toBe(false);
    expect(await store.results.consume("r1", requirement.expiresAt)).toBe(true);
    expect(await store.results.consume("r1", requirement.expiresAt)).toBe(
      false,
    );
    await expect(
      store.providers.consume({
        providerId: "world",
        methodId: "proof-of-human",
        uniquenessScope: { kind: "action", id: "one" },
        subjectDigest: "hmac-sha256:same",
      }),
    ).resolves.toBe(true);
    await expect(
      store.providers.consume({
        providerId: "world",
        methodId: "proof-of-human",
        uniquenessScope: { kind: "action", id: "two" },
        subjectDigest: "hmac-sha256:same",
      }),
    ).resolves.toBe(true);
  });
});
