import { describe, expect, it } from "vitest";
import type { RedisClientType } from "redis";
import { createHumanRequirement } from "../src/core.js";
import { RedisX424Store, type RedisCommandClient } from "../src/redis.js";

class FakeRedisClient implements RedisCommandClient {
  readonly values = new Map<
    string,
    { readonly value: string; readonly expiresAtMs?: number }
  >();

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
      const nonceKey = arguments_[3]!;
      const expectedNonce = arguments_[4]!;
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
  new RedisX424Store({ client });
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

describe("Redis x424 state", () => {
  it("stores requirements and atomically consumes nonces and results", async () => {
    const state = new RedisX424Store({
      client: new FakeRedisClient(),
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
});
