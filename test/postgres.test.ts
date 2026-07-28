import { describe, expect, it } from "vitest";
import {
  POSTGRES_X424_SCHEMA_SQL,
  PostgresX424Store,
  createHumanRequirement,
} from "../src/core.js";
import type { StoredHumanHandoff } from "../src/handoff.js";

class MemoryPg {
  nonces = new Map<string, { nonce: string; expiresAt: string }>();
  requirements = new Map<
    string,
    { document: string; expiresAt: string; ownerId?: string }
  >();
  providers = new Set<string>();
  results = new Set<string>();
  acceptances = new Map<
    string,
    { operationId: string; requestDigest: string; expiresAt: string }
  >();
  handoffs = new Map<
    string,
    {
      dependencyId: string;
      accessTokenDigest: string;
      version: number;
      active: boolean;
      document: string;
    }
  >();

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
      const owned = text.includes("owner_id");
      this.requirements.set(String(params[0]), {
        document: String(params[owned ? 2 : 1]),
        expiresAt: String(params[owned ? 3 : 2]),
        ...(owned ? { ownerId: String(params[1]) } : {}),
      });
      return { rowCount: 1, rows: [] };
    }
    if (text.includes("INSERT INTO x424_handoffs")) {
      const handoffId = String(params[0]);
      const dependencyId = String(params[1]);
      const duplicate =
        this.handoffs.has(handoffId) ||
        [...this.handoffs.values()].some(
          (entry) => entry.active && entry.dependencyId === dependencyId,
        );
      if (duplicate) return { rowCount: 0, rows: [] };
      this.handoffs.set(handoffId, {
        dependencyId,
        accessTokenDigest: String(params[2]),
        version: Number(params[4]),
        active: true,
        document: String(params[5]),
      });
      return { rowCount: 1, rows: [{ handoff_id: handoffId }] };
    }
    if (text.includes("SELECT document FROM x424_handoffs")) {
      const entry = this.handoffs.get(String(params[0]));
      if (!entry || entry.accessTokenDigest !== params[1]) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [{ document: JSON.parse(entry.document) }] };
    }
    if (text.includes("UPDATE x424_handoffs")) {
      const handoffId = String(params[5]);
      const entry = this.handoffs.get(handoffId);
      if (
        !entry ||
        entry.accessTokenDigest !== params[6] ||
        entry.version !== params[7]
      ) {
        return { rowCount: 0, rows: [] };
      }
      this.handoffs.set(handoffId, {
        ...entry,
        active: Boolean(params[1]),
        version: Number(params[2]),
        document: String(params[3]),
      });
      return { rowCount: 1, rows: [{ handoff_id: handoffId }] };
    }
    if (text.includes("SELECT document")) {
      const entry = this.requirements.get(String(params[0]));
      if (
        !entry ||
        (text.includes("owner_id = $2") && entry.ownerId !== params[1])
      ) {
        return { rowCount: 0, rows: [] };
      }
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
      const entry = this.requirements.get(String(params[0]));
      if (
        text.includes("owner_id = $2") &&
        (!entry || entry.ownerId !== params[1])
      ) {
        return { rowCount: 0, rows: [] };
      }
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
    if (
      text.includes("WITH legacy_result") &&
      text.includes("INSERT INTO x424_results")
    ) {
      const scopedResultId = String(params[0]);
      const legacyResultId = String(params[1]);
      const consumed =
        !this.results.has(legacyResultId) && !this.results.has(scopedResultId);
      if (consumed) this.results.add(scopedResultId);
      return { rowCount: 1, rows: [{ consumed }] };
    }
    if (text.includes("INSERT INTO x424_results")) {
      if (this.results.has(String(params[0]))) {
        return { rowCount: 0, rows: [] };
      }
      this.results.add(String(params[0]));
      return { rowCount: 1, rows: [{ result_id: params[0] }] };
    }
    if (
      text.includes("WITH legacy_result") &&
      text.includes("INSERT INTO x424_result_acceptances")
    ) {
      const scopedResultId = String(params[0]);
      const legacyResultId = String(params[1]);
      const operationId = String(params[2]);
      const requestDigest = String(params[3]);
      const existing =
        this.acceptances.get(legacyResultId) ??
        this.acceptances.get(scopedResultId);
      if (!existing) {
        this.acceptances.set(scopedResultId, {
          operationId,
          requestDigest,
          expiresAt: String(params[5]),
        });
        return { rowCount: 1, rows: [{ status: "new" }] };
      }
      return {
        rowCount: 1,
        rows: [
          {
            status:
              existing.operationId === operationId &&
              existing.requestDigest === requestDigest
                ? "same_operation"
                : "replay",
          },
        ],
      };
    }
    if (text.includes("INSERT INTO x424_result_acceptances")) {
      const resultId = String(params[0]);
      const existing = this.acceptances.get(resultId);
      if (!existing) {
        this.acceptances.set(resultId, {
          operationId: String(params[1]),
          requestDigest: String(params[2]),
          expiresAt: String(params[3]),
        });
        return { rowCount: 1, rows: [{ status: "new" }] };
      }
      const same =
        existing.operationId === params[1] &&
        existing.requestDigest === params[2] &&
        Date.parse(existing.expiresAt) > Date.now();
      return {
        rowCount: 1,
        rows: [{ status: same ? "same_operation" : "replay" }],
      };
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
    expect(
      await store.results.consume("legacy-result", requirement.expiresAt),
    ).toBe(true);
    expect(
      await store.results.consumeWithLegacy(
        "tenant-scoped-result",
        "legacy-result",
        requirement.expiresAt,
      ),
    ).toBe(false);
    expect(
      await store.results.consumeWithLegacy(
        "tenant-scoped-new-result",
        "unused-legacy-result",
        requirement.expiresAt,
      ),
    ).toBe(true);
    const acceptance = {
      resultId: "r-x402",
      operationId: "operation-1",
      requestDigest: requirement.resource.requestDigest,
      expiresAt: requirement.expiresAt,
    };
    expect(await store.resultAcceptances.accept(acceptance)).toBe("new");
    expect(await store.resultAcceptances.accept(acceptance)).toBe(
      "same_operation",
    );
    expect(
      await store.resultAcceptances.accept({
        ...acceptance,
        requestDigest: "sha256:different",
      }),
    ).toBe("replay");
    const legacyAcceptance = {
      ...acceptance,
      resultId: "legacy-acceptance",
    };
    expect(await store.resultAcceptances.accept(legacyAcceptance)).toBe("new");
    expect(
      await store.resultAcceptances.acceptWithLegacy(
        { ...legacyAcceptance, resultId: "tenant-scoped-acceptance" },
        "legacy-acceptance",
      ),
    ).toBe("same_operation");
    expect(
      await store.resultAcceptances.acceptWithLegacy(
        {
          ...legacyAcceptance,
          resultId: "tenant-scoped-acceptance",
          operationId: "different-operation",
        },
        "legacy-acceptance",
      ),
    ).toBe("replay");
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

  it("persists requirement ownership for authenticated management", async () => {
    const store = new PostgresX424Store({ client: new MemoryPg() });
    const requirement = createHumanRequirement({
      purpose: "publish-record",
      method: "POST",
      uri: "https://api.example.test/records",
      audience: "https://api.example.test",
      binding: { kind: "agent_key", value: "sha256:tenant" },
      accepts: [
        {
          providerId: "example",
          methodId: "unique-human",
          descriptorVersion: "1",
          acceptedScopeKinds: ["relying_party"],
        },
      ],
    });
    await store.requirements.putForTenant(requirement, "tenant-a");
    await expect(
      store.requirements.getForTenant(requirement.dependencyId, "tenant-b"),
    ).resolves.toBeUndefined();
    await expect(
      store.requirements.deleteForTenant(requirement.dependencyId, "tenant-b"),
    ).resolves.toBe(false);
    await expect(
      store.requirements.getForTenant(requirement.dependencyId, "tenant-a"),
    ).resolves.toEqual(requirement);
    await expect(
      store.requirements.deleteForTenant(requirement.dependencyId, "tenant-a"),
    ).resolves.toBe(true);
  });

  it("atomically stores and compare-and-swaps brokered handoffs", async () => {
    const store = new PostgresX424Store({ client: new MemoryPg() }).handoffs;
    const first: StoredHumanHandoff = {
      handoffId: "handoff-1",
      dependencyId: "dependency-1",
      providerId: "example",
      methodId: "unique-human",
      accessTokenDigest: "sha256:capability",
      status: "pending",
      presentation: { kind: "uri", uri: "https://connector.example.test" },
      protectedState: "encrypted-state",
      pollAfterMs: 1000,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      version: 1,
    };
    expect(await store.create(first)).toBe(true);
    expect(await store.create({ ...first, handoffId: "handoff-2" })).toBe(
      false,
    );
    await expect(
      store.getAuthorized(first.handoffId, "wrong"),
    ).resolves.toBeUndefined();
    await expect(
      store.getAuthorized(first.handoffId, first.accessTokenDigest),
    ).resolves.toEqual(first);

    const completed: StoredHumanHandoff = {
      ...first,
      status: "completed",
      protectedCompletion: "encrypted-result",
      version: 2,
    };
    expect(await store.update(first, completed)).toBe(true);
    expect(await store.update(first, completed)).toBe(false);
    expect(await store.create({ ...first, handoffId: "handoff-2" })).toBe(true);
  });
});
