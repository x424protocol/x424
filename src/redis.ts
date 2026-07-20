import { canonicalJson } from "./canonical.js";
import { parseHumanRequirement } from "./schemas.js";
import type {
  HumanRequirement,
  IsoTimestamp,
  NonceStore,
  ProviderReplayEntry,
  ProviderReplayStore,
  RequirementStore,
  ResultReplayStore,
} from "./types.js";
import type { RateLimitResult } from "./ops/limits.js";

/** Minimal command surface implemented by the official `redis` client. */
export interface RedisCommandClient {
  sendCommand(arguments_: readonly string[]): Promise<unknown>;
}

export interface RedisX424StoreOptions {
  readonly client: RedisCommandClient;
  readonly keyPrefix?: string;
}

const CONSUME_NONCE_SCRIPT = [
  "local value = redis.call('GET', KEYS[1])",
  "if value == ARGV[1] then",
  "  redis.call('DEL', KEYS[1])",
  "  return 1",
  "end",
  "return 0",
].join("\n");

const RATE_LIMIT_SCRIPT = [
  "local current = redis.call('INCR', KEYS[1])",
  "if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end",
  "local ttl = redis.call('PTTL', KEYS[1])",
  "return {current, ttl}",
].join("\n");

export interface RedisRateLimiterOptions {
  readonly client: RedisCommandClient;
  readonly windowMs: number;
  readonly maxRequests: number;
  readonly keyPrefix?: string;
}

/** Shared fixed-window limiter for multi-instance verifier deployments. */
export class RedisRateLimiter {
  readonly #client: RedisCommandClient;
  readonly #windowMs: number;
  readonly #maxRequests: number;
  readonly #prefix: string;

  constructor(options: RedisRateLimiterOptions) {
    if (
      !Number.isInteger(options.windowMs) ||
      options.windowMs < 1 ||
      !Number.isInteger(options.maxRequests) ||
      options.maxRequests < 1
    ) {
      throw new Error("Redis rate-limit window and maximum must be positive");
    }
    this.#client = options.client;
    this.#windowMs = options.windowMs;
    this.#maxRequests = options.maxRequests;
    this.#prefix = options.keyPrefix ?? "x424:rate";
  }

  async consume(key: string, now = Date.now()): Promise<RateLimitResult> {
    if (!key || /[\u0000\r\n]/u.test(key)) {
      throw new Error("Invalid Redis rate-limit key");
    }
    const response = await this.#client.sendCommand([
      "EVAL",
      RATE_LIMIT_SCRIPT,
      "1",
      `${this.#prefix}:${key}`,
      String(this.#windowMs),
    ]);
    if (!Array.isArray(response) || response.length !== 2) {
      throw new Error("Redis returned an invalid rate-limit response");
    }
    const current = Number(response[0]);
    const ttl = Math.max(0, Number(response[1]));
    if (!Number.isFinite(current) || !Number.isFinite(ttl)) {
      throw new Error("Redis returned an invalid rate-limit response");
    }
    return {
      allowed: current <= this.#maxRequests,
      remaining: Math.max(0, this.#maxRequests - current),
      resetAt: now + ttl,
    };
  }
}

/**
 * Shared Redis 6.2+ state for a production-shaped x424 verifier.
 *
 * The class uses raw Redis commands so adopters can pass the official
 * `createClient()` result without coupling x424 core to a Redis package
 * version. Challenge consumption and result replay checks are atomic.
 */
export class RedisX424Store {
  readonly #client: RedisCommandClient;
  readonly #prefix: string;
  readonly nonces: NonceStore;
  readonly providers: ProviderReplayStore;
  readonly requirements: RequirementStore;
  readonly results: ResultReplayStore;

  constructor(options: RedisX424StoreOptions) {
    const prefix = options.keyPrefix ?? "x424";
    if (!prefix || /[\s\u0000]/u.test(prefix)) {
      throw new Error("Redis keyPrefix must be a non-empty token");
    }
    this.#client = options.client;
    this.#prefix = prefix;
    this.nonces = Object.freeze({
      put: (dependencyId: string, nonce: string, expiresAt: IsoTimestamp) =>
        this.#putNonce(dependencyId, nonce, expiresAt),
      consume: (dependencyId: string, nonce: string) =>
        this.#consumeNonce(dependencyId, nonce),
    });
    this.providers = Object.freeze({
      consume: (entry: ProviderReplayEntry) => this.#consumeProvider(entry),
    });
    this.requirements = Object.freeze({
      put: (requirement: HumanRequirement) => this.#putRequirement(requirement),
      get: (dependencyId: string, now?: Date) =>
        this.#getRequirement(dependencyId, now),
      delete: (dependencyId: string) => this.#deleteRequirement(dependencyId),
    });
    this.results = Object.freeze({
      consume: (resultId: string, expiresAt: IsoTimestamp, now?: Date) =>
        this.#consumeResult(resultId, expiresAt, now),
    });
  }

  async #putNonce(
    dependencyId: string,
    nonce: string,
    expiresAt: IsoTimestamp,
  ): Promise<void> {
    if (!nonce) throw new Error("Invalid nonce entry");
    await this.#setOnce(
      this.#key("nonce", dependencyId),
      nonce,
      expiresAt,
      "Dependency ID already exists",
    );
  }

  async #consumeNonce(dependencyId: string, nonce: string): Promise<boolean> {
    const response = await this.#client.sendCommand([
      "EVAL",
      CONSUME_NONCE_SCRIPT,
      "1",
      this.#key("nonce", dependencyId),
      nonce,
    ]);
    return response === 1 || response === "1";
  }

  async #consumeProvider(entry: ProviderReplayEntry): Promise<boolean> {
    if (
      !entry.providerId ||
      !entry.methodId ||
      !entry.uniquenessScope.id ||
      !entry.subjectDigest
    ) {
      return false;
    }
    const response = await this.#client.sendCommand([
      "SET",
      this.#key(
        "provider",
        [
          entry.providerId,
          entry.methodId,
          entry.uniquenessScope.kind,
          entry.uniquenessScope.id,
          entry.subjectDigest,
        ].join(":"),
      ),
      "1",
      "NX",
    ]);
    return response === "OK";
  }

  async #putRequirement(requirement: HumanRequirement): Promise<void> {
    await this.#setOnce(
      this.#key("requirement", requirement.dependencyId),
      canonicalJson(requirement),
      requirement.expiresAt,
      "Dependency ID already exists",
    );
  }

  async #getRequirement(
    dependencyId: string,
    now = new Date(),
  ): Promise<HumanRequirement | undefined> {
    const value = await this.#client.sendCommand([
      "GET",
      this.#key("requirement", dependencyId),
    ]);
    if (typeof value !== "string") return undefined;
    const requirement = parseHumanRequirement(JSON.parse(value));
    if (Date.parse(requirement.expiresAt) <= now.getTime()) {
      await this.#deleteRequirement(dependencyId);
      return undefined;
    }
    return requirement;
  }

  async #deleteRequirement(dependencyId: string): Promise<void> {
    await this.#client.sendCommand([
      "DEL",
      this.#key("requirement", dependencyId),
    ]);
  }

  async #consumeResult(
    resultId: string,
    expiresAt: string,
    now = new Date(),
  ): Promise<boolean> {
    const expiresAtMs = this.#futureExpiry(expiresAt, now);
    if (expiresAtMs === undefined) return false;
    const response = await this.#client.sendCommand([
      "SET",
      this.#key("result", resultId),
      "1",
      "NX",
      "PXAT",
      String(expiresAtMs),
    ]);
    return response === "OK";
  }

  async #setOnce(
    key: string,
    value: string,
    expiresAt: IsoTimestamp,
    duplicateMessage: string,
  ): Promise<void> {
    const expiresAtMs = this.#futureExpiry(expiresAt, new Date());
    if (expiresAtMs === undefined) throw new Error("Invalid or expired entry");
    const response = await this.#client.sendCommand([
      "SET",
      key,
      value,
      "NX",
      "PXAT",
      String(expiresAtMs),
    ]);
    if (response !== "OK") throw new Error(duplicateMessage);
  }

  #futureExpiry(expiresAt: IsoTimestamp, now: Date): number | undefined {
    const expiresAtMs = Date.parse(expiresAt);
    return Number.isFinite(expiresAtMs) && expiresAtMs > now.getTime()
      ? expiresAtMs
      : undefined;
  }

  #key(
    kind: "nonce" | "provider" | "requirement" | "result",
    id: string,
  ): string {
    if (!id) throw new Error("x424 store ID is required");
    return `${this.#prefix}:${kind}:${id}`;
  }
}
