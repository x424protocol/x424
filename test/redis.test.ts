import { describe, expect, it } from "vitest";
import type { RedisClientType } from "redis";
import { createHumanRequirement } from "../src/core.js";
import {
  RedisRateLimiter,
  RedisX424Store,
  type RedisCommandClient,
} from "../src/redis.js";
import type { StoredHumanHandoff } from "../src/handoff.js";

class FakeRedisClient implements RedisCommandClient {
  readonly values = new Map<
    string,
    { readonly value: string; readonly expiresAtMs?: number }
  >();
  readonly rateHits = new Map<string, number>();

  async sendCommand(arguments_: readonly string[]): Promise<unknown> {
    const [command, key] = arguments_;
    if (command === "SET") {
      const value = arguments_[2]!;
      const nx = arguments_.includes("NX");
      const pxatIndex = arguments_.indexOf("PXAT");
      this.#expire(key!);
      if (nx && this.values.has(key!)) return null;
      this.values.set(key!, {
        value,
        ...(pxatIndex === -1
          ? {}
          : { expiresAtMs: Number(arguments_[pxatIndex + 1]) }),
      });
      return "OK";
    }
    if (command === "GET") {
      this.#expire(key!);
      return this.values.get(key!)?.value ?? null;
    }
    if (command === "DEL") return this.values.delete(key!) ? 1 : 0;
    if (command === "EVAL") {
      const script = arguments_[1]!;
      const nonceKey = arguments_[3]!;
      const expectedNonce = arguments_[4]!;
      if (nonceKey.startsWith("test-rate:")) {
        const current = (this.rateHits.get(nonceKey) ?? 0) + 1;
        this.rateHits.set(nonceKey, current);
        return [current, Number(expectedNonce)];
      }
      if (nonceKey.includes(":acceptance:")) {
        if (arguments_[2] === "2") {
          const legacyKey = arguments_[4]!;
          const value = arguments_[5]!;
          const expiresAtMs = Number(arguments_[6]);
          this.#expire(nonceKey);
          this.#expire(legacyKey);
          const existing =
            this.values.get(legacyKey)?.value ??
            this.values.get(nonceKey)?.value;
          if (existing === undefined) {
            this.values.set(nonceKey, { value, expiresAtMs });
            return 1;
          }
          return existing === value ? 2 : 0;
        }
        const expiresAtMs = Number(arguments_[5]);
        this.#expire(nonceKey);
        const existing = this.values.get(nonceKey)?.value;
        if (existing === undefined) {
          this.values.set(nonceKey, {
            value: expectedNonce,
            expiresAtMs,
          });
          return 1;
        }
        return existing === expectedNonce ? 2 : 0;
      }
      if (nonceKey.includes(":result:") && arguments_[2] === "2") {
        const legacyKey = arguments_[4]!;
        const expiresAtMs = Number(arguments_[5]);
        this.#expire(nonceKey);
        this.#expire(legacyKey);
        if (this.values.has(legacyKey) || this.values.has(nonceKey)) return 0;
        this.values.set(nonceKey, { value: "1", expiresAtMs });
        return 1;
      }
      if (script.includes("ARGV[4] == '1'")) {
        const dependencyKey = arguments_[4]!;
        const previous = arguments_[5]!;
        const next = arguments_[6]!;
        const expiresAtMs = Number(arguments_[7]);
        const terminal = arguments_[8] === "1";
        const handoffId = arguments_[9]!;
        this.#expire(nonceKey);
        if (this.values.get(nonceKey)?.value !== previous) return 0;
        this.values.set(nonceKey, { value: next, expiresAtMs });
        if (terminal) {
          if (this.values.get(dependencyKey)?.value === handoffId) {
            this.values.delete(dependencyKey);
          }
        } else {
          this.values.set(dependencyKey, { value: handoffId, expiresAtMs });
        }
        return 1;
      }
      if (script.includes("redis.call('EXISTS', KEYS[2])")) {
        const dependencyKey = arguments_[4]!;
        const document = arguments_[5]!;
        const expiresAtMs = Number(arguments_[6]);
        const handoffId = arguments_[7]!;
        this.#expire(nonceKey);
        this.#expire(dependencyKey);
        if (this.values.has(nonceKey) || this.values.has(dependencyKey))
          return 0;
        this.values.set(nonceKey, { value: document, expiresAtMs });
        this.values.set(dependencyKey, { value: handoffId, expiresAtMs });
        return 1;
      }
      this.#expire(nonceKey);
      if (this.values.get(nonceKey)?.value !== expectedNonce) return 0;
      this.values.delete(nonceKey);
      return 1;
    }
    throw new Error(`Unsupported fake Redis command: ${command}`);
  }

  #expire(key: string): void {
    const entry = this.values.get(key);
    if (entry?.expiresAtMs && entry.expiresAtMs <= Date.now()) {
      this.values.delete(key);
    }
  }
}

// Compile-time contract: the official Redis client can be passed directly.
const officialClientCompatibility = (client: RedisClientType) =>
  new RedisX424Store({ client, topology: "single-endpoint" });
void officialClientCompatibility;

function requirement() {
  return createHumanRequirement({
    purpose: "publish-record",
    method: "POST",
    uri: "https://api.example.test/records",
    audience: "https://api.example.test",
    binding: { kind: "wallet", value: "0x1234" },
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

function handoff(
  overrides: Partial<StoredHumanHandoff> = {},
): StoredHumanHandoff {
  return {
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
    ...overrides,
  };
}

describe("Redis x424 state", () => {
  it("rejects an implicit or clustered Redis topology", () => {
    const client = new FakeRedisClient();
    expect(
      () =>
        new RedisX424Store({
          client,
        } as unknown as ConstructorParameters<typeof RedisX424Store>[0]),
    ).toThrow(/single-endpoint/);
    expect(
      () =>
        new RedisX424Store({
          client,
          topology: "cluster",
        } as unknown as ConstructorParameters<typeof RedisX424Store>[0]),
    ).toThrow(/Redis Cluster is unsupported/);
  });

  it("stores requirements and atomically consumes nonces and results", async () => {
    const state = new RedisX424Store({
      client: new FakeRedisClient(),
      topology: "single-endpoint",
      keyPrefix: "test-x424",
    });
    const required = requirement();
    const nonceWithTimestampLetter = "nonce-With-T-character";

    await state.requirements.put(required);
    await state.nonces.put(
      required.dependencyId,
      nonceWithTimestampLetter,
      required.expiresAt,
    );
    await expect(
      state.requirements.get(required.dependencyId),
    ).resolves.toEqual(required);
    await expect(
      state.nonces.consume(required.dependencyId, nonceWithTimestampLetter),
    ).resolves.toBe(true);
    await expect(
      state.nonces.consume(required.dependencyId, nonceWithTimestampLetter),
    ).resolves.toBe(false);

    await expect(
      state.results.consume("result-1", required.expiresAt),
    ).resolves.toBe(true);
    await expect(
      state.results.consume("result-1", required.expiresAt),
    ).resolves.toBe(false);
    await expect(
      state.results.consume("legacy-result", required.expiresAt),
    ).resolves.toBe(true);
    await expect(
      state.results.consumeWithLegacy(
        "tenant-scoped-result",
        "legacy-result",
        required.expiresAt,
      ),
    ).resolves.toBe(false);
    await expect(
      state.results.consumeWithLegacy(
        "tenant-scoped-new-result",
        "unused-legacy-result",
        required.expiresAt,
      ),
    ).resolves.toBe(true);

    const acceptance = {
      resultId: "result-x402",
      operationId: "operation-1",
      requestDigest: required.resource.requestDigest,
      expiresAt: required.expiresAt,
    };
    await expect(state.resultAcceptances.accept(acceptance)).resolves.toBe(
      "new",
    );
    await expect(state.resultAcceptances.accept(acceptance)).resolves.toBe(
      "same_operation",
    );
    await expect(
      state.resultAcceptances.accept({
        ...acceptance,
        operationId: "operation-2",
      }),
    ).resolves.toBe("replay");
    const legacyAcceptance = {
      ...acceptance,
      resultId: "legacy-acceptance",
    };
    await expect(
      state.resultAcceptances.accept(legacyAcceptance),
    ).resolves.toBe("new");
    await expect(
      state.resultAcceptances.acceptWithLegacy(
        { ...legacyAcceptance, resultId: "tenant-scoped-acceptance" },
        "legacy-acceptance",
      ),
    ).resolves.toBe("same_operation");
    await expect(
      state.resultAcceptances.acceptWithLegacy(
        {
          ...legacyAcceptance,
          resultId: "tenant-scoped-acceptance",
          operationId: "operation-2",
        },
        "legacy-acceptance",
      ),
    ).resolves.toBe("replay");

    const providerEntry = {
      providerId: "world",
      methodId: "proof-of-human",
      uniquenessScope: { kind: "action", id: "world:rp:action" },
      subjectDigest: "hmac-sha256:private-digest",
    } as const;
    await expect(state.providers.consume(providerEntry)).resolves.toBe(true);
    await expect(state.providers.consume(providerEntry)).resolves.toBe(false);

    await state.requirements.delete(required.dependencyId);
    await expect(
      state.requirements.get(required.dependencyId),
    ).resolves.toBeUndefined();
  });

  it("persists requirement ownership for authenticated management", async () => {
    const state = new RedisX424Store({
      client: new FakeRedisClient(),
      topology: "single-endpoint",
      keyPrefix: "test-x424",
    });
    const required = requirement();
    await state.requirements.putForTenant(required, "tenant-a");

    await expect(
      state.requirements.get(required.dependencyId),
    ).resolves.toEqual(required);
    await expect(
      state.requirements.getForTenant(required.dependencyId, "tenant-b"),
    ).resolves.toBeUndefined();
    await expect(
      state.requirements.deleteForTenant(required.dependencyId, "tenant-b"),
    ).resolves.toBe(false);
    await expect(
      state.requirements.getForTenant(required.dependencyId, "tenant-a"),
    ).resolves.toEqual(required);
    await expect(
      state.requirements.deleteForTenant(required.dependencyId, "tenant-a"),
    ).resolves.toBe(true);
  });

  it("shares rate limits through Redis", async () => {
    const limiter = new RedisRateLimiter({
      client: new FakeRedisClient(),
      keyPrefix: "test-rate",
      windowMs: 60_000,
      maxRequests: 2,
    });
    await expect(limiter.consume("issue:client")).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });
    await expect(limiter.consume("issue:client")).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
    });
    await expect(limiter.consume("issue:client")).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
    });
  });

  it("atomically stores and updates one active handoff per dependency", async () => {
    const store = new RedisX424Store({
      client: new FakeRedisClient(),
      topology: "single-endpoint",
      keyPrefix: "test-x424",
    }).handoffs;
    const first = handoff();
    expect(await store.create(first)).toBe(true);
    expect(await store.create(handoff({ handoffId: "handoff-2" }))).toBe(false);
    await expect(
      store.getAuthorized(first.handoffId, "wrong"),
    ).resolves.toBeUndefined();
    await expect(
      store.getAuthorized(first.handoffId, first.accessTokenDigest),
    ).resolves.toEqual(first);

    const completed = {
      ...first,
      status: "completed" as const,
      protectedCompletion: "encrypted-result",
      version: 2,
    };
    expect(await store.update(first, completed)).toBe(true);
    expect(await store.update(first, completed)).toBe(false);
    expect(await store.create(handoff({ handoffId: "handoff-2" }))).toBe(true);
  });
});
