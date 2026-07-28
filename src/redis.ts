import { canonicalJson } from "./canonical.js";
import { parseHumanRequirement } from "./schemas.js";
import type {
  HumanRequirement,
  IsoTimestamp,
  LegacyAwareResultAcceptanceStore,
  LegacyAwareResultReplayStore,
  NonceStore,
  ProviderReplayEntry,
  ProviderReplayStore,
  ResultAcceptanceStore,
  TenantIsolatedRequirementStore,
} from "./types.js";
import type { RateLimitResult } from "./ops/limits.js";
import {
  parseStoredHumanHandoff,
  type HandoffStore,
  type StoredHumanHandoff,
} from "./handoff.js";

/** Minimal command surface implemented by the official `redis` client. */
export interface RedisCommandClient {
  sendCommand(arguments_: readonly string[]): Promise<unknown>;
}

export interface RedisX424StoreOptions {
  readonly client: RedisCommandClient;
  /**
   * The 0.1.3 legacy/new-key migration uses multi-key Lua. Redis Cluster is
   * intentionally unsupported until every state key shares a hash slot.
   */
  readonly topology: "single-endpoint";
  readonly keyPrefix?: string;
}

interface StoredRequirementEnvelope {
  readonly x424RequirementStoreVersion: 1;
  readonly tenantId: string;
  readonly requirement: HumanRequirement;
}

function assertRequirementTenantId(tenantId: string): void {
  if (
    !tenantId ||
    tenantId.length > 512 ||
    /[\u0000-\u001f\u007f]/u.test(tenantId)
  ) {
    throw new Error("Invalid requirement tenant ID");
  }
}

function parseStoredRequirement(value: string): {
  readonly requirement: HumanRequirement;
  readonly tenantId?: string;
} {
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    Object.prototype.hasOwnProperty.call(
      parsed,
      "x424RequirementStoreVersion",
    ) &&
    (parsed as Record<string, unknown>).x424RequirementStoreVersion === 1
  ) {
    const envelope = parsed as Partial<StoredRequirementEnvelope>;
    assertRequirementTenantId(envelope.tenantId ?? "");
    return {
      requirement: parseHumanRequirement(envelope.requirement),
      tenantId: envelope.tenantId!,
    };
  }
  // Requirements created before tenant ownership was introduced remain
  // usable by proof/handoff flows but are not exposed by management APIs.
  return { requirement: parseHumanRequirement(parsed) };
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

const ACCEPT_RESULT_SCRIPT = [
  "local current = redis.call('GET', KEYS[1])",
  "if not current then",
  "  redis.call('SET', KEYS[1], ARGV[1], 'PXAT', ARGV[2])",
  "  return 1",
  "end",
  "if current == ARGV[1] then return 2 end",
  "return 0",
].join("\n");

const CONSUME_RESULT_WITH_LEGACY_SCRIPT = [
  "if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end",
  "if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end",
  "redis.call('SET', KEYS[1], '1', 'PXAT', ARGV[1])",
  "return 1",
].join("\n");

const ACCEPT_RESULT_WITH_LEGACY_SCRIPT = [
  "local current = redis.call('GET', KEYS[2])",
  "if not current then current = redis.call('GET', KEYS[1]) end",
  "if not current then",
  "  redis.call('SET', KEYS[1], ARGV[1], 'PXAT', ARGV[2])",
  "  return 1",
  "end",
  "if current == ARGV[1] then return 2 end",
  "return 0",
].join("\n");

const CREATE_HANDOFF_SCRIPT = [
  "if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end",
  "if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end",
  "redis.call('SET', KEYS[1], ARGV[1], 'PXAT', ARGV[2])",
  "redis.call('SET', KEYS[2], ARGV[3], 'PXAT', ARGV[2])",
  "return 1",
].join("\n");

const UPDATE_HANDOFF_SCRIPT = [
  "local current = redis.call('GET', KEYS[1])",
  "if current ~= ARGV[1] then return 0 end",
  "redis.call('SET', KEYS[1], ARGV[2], 'PXAT', ARGV[3])",
  "if ARGV[4] == '1' then",
  "  if redis.call('GET', KEYS[2]) == ARGV[5] then redis.call('DEL', KEYS[2]) end",
  "else",
  "  redis.call('SET', KEYS[2], ARGV[5], 'PXAT', ARGV[3])",
  "end",
  "return 1",
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
  readonly requirements: TenantIsolatedRequirementStore;
  readonly results: LegacyAwareResultReplayStore;
  readonly resultAcceptances: LegacyAwareResultAcceptanceStore;
  readonly handoffs: HandoffStore;

  constructor(options: RedisX424StoreOptions) {
    if (options.topology !== "single-endpoint") {
      throw new Error(
        "RedisX424Store requires topology=single-endpoint; Redis Cluster is unsupported",
      );
    }
    const prefix = options.keyPrefix ?? "x424";
    if (!prefix || /[\s\u0000]/u.test(prefix)) {
      throw new Error("Redis keyPrefix must be a non-empty token");
    }
    this.#client = options.client;
    this.#prefix = prefix;
    this.handoffs = new RedisHandoffStore(options);
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
      tenantIsolation: true as const,
      put: (requirement: HumanRequirement) => this.#putRequirement(requirement),
      putForTenant: (requirement: HumanRequirement, tenantId: string) =>
        this.#putRequirement(requirement, tenantId),
      get: (dependencyId: string, now?: Date) =>
        this.#getRequirement(dependencyId, now),
      getForTenant: (dependencyId: string, tenantId: string, now?: Date) =>
        this.#getRequirementForTenant(dependencyId, tenantId, now),
      delete: (dependencyId: string) => this.#deleteRequirement(dependencyId),
      deleteForTenant: (dependencyId: string, tenantId: string) =>
        this.#deleteRequirementForTenant(dependencyId, tenantId),
    });
    this.results = Object.freeze({
      legacyResultStateMigration: true as const,
      consume: (resultId: string, expiresAt: IsoTimestamp, now?: Date) =>
        this.#consumeResult(resultId, expiresAt, now),
      consumeWithLegacy: (
        resultId: string,
        legacyResultId: string,
        expiresAt: IsoTimestamp,
        now?: Date,
      ) =>
        this.#consumeResultWithLegacy(resultId, legacyResultId, expiresAt, now),
    });
    this.resultAcceptances = Object.freeze({
      legacyResultStateMigration: true as const,
      accept: (
        input: Parameters<ResultAcceptanceStore["accept"]>[0],
        now?: Date,
      ) => this.#acceptResult(input, now),
      acceptWithLegacy: (
        input: Parameters<ResultAcceptanceStore["accept"]>[0],
        legacyResultId: string,
        now?: Date,
      ) => this.#acceptResultWithLegacy(input, legacyResultId, now),
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

  async #putRequirement(
    requirement: HumanRequirement,
    tenantId?: string,
  ): Promise<void> {
    if (tenantId !== undefined) assertRequirementTenantId(tenantId);
    await this.#setOnce(
      this.#key("requirement", requirement.dependencyId),
      tenantId === undefined
        ? canonicalJson(requirement)
        : canonicalJson({
            x424RequirementStoreVersion: 1,
            tenantId,
            requirement,
          } satisfies StoredRequirementEnvelope),
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
    const { requirement } = parseStoredRequirement(value);
    if (Date.parse(requirement.expiresAt) <= now.getTime()) {
      await this.#deleteRequirement(dependencyId);
      return undefined;
    }
    return requirement;
  }

  async #getRequirementForTenant(
    dependencyId: string,
    tenantId: string,
    now = new Date(),
  ): Promise<HumanRequirement | undefined> {
    assertRequirementTenantId(tenantId);
    const value = await this.#client.sendCommand([
      "GET",
      this.#key("requirement", dependencyId),
    ]);
    if (typeof value !== "string") return undefined;
    const stored = parseStoredRequirement(value);
    if (Date.parse(stored.requirement.expiresAt) <= now.getTime()) {
      await this.#deleteRequirement(dependencyId);
      return undefined;
    }
    return stored.tenantId === tenantId ? stored.requirement : undefined;
  }

  async #deleteRequirement(dependencyId: string): Promise<void> {
    await this.#client.sendCommand([
      "DEL",
      this.#key("requirement", dependencyId),
    ]);
  }

  async #deleteRequirementForTenant(
    dependencyId: string,
    tenantId: string,
  ): Promise<boolean> {
    assertRequirementTenantId(tenantId);
    const value = await this.#client.sendCommand([
      "GET",
      this.#key("requirement", dependencyId),
    ]);
    if (typeof value !== "string") return false;
    const stored = parseStoredRequirement(value);
    if (
      stored.tenantId !== tenantId ||
      Date.parse(stored.requirement.expiresAt) <= Date.now()
    ) {
      return false;
    }
    const response = await this.#client.sendCommand([
      "EVAL",
      CONSUME_NONCE_SCRIPT,
      "1",
      this.#key("requirement", dependencyId),
      value,
    ]);
    return response === 1 || response === "1";
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

  async #consumeResultWithLegacy(
    resultId: string,
    legacyResultId: string,
    expiresAt: string,
    now = new Date(),
  ): Promise<boolean> {
    const expiresAtMs = this.#futureExpiry(expiresAt, now);
    if (
      expiresAtMs === undefined ||
      !resultId ||
      !legacyResultId ||
      legacyResultId.length > 200
    ) {
      return false;
    }
    const response = await this.#client.sendCommand([
      "EVAL",
      CONSUME_RESULT_WITH_LEGACY_SCRIPT,
      "2",
      this.#key("result", resultId),
      this.#key("result", legacyResultId),
      String(expiresAtMs),
    ]);
    return response === 1 || response === "1";
  }

  async #acceptResult(
    input: Parameters<ResultAcceptanceStore["accept"]>[0],
    now = new Date(),
  ): Promise<Awaited<ReturnType<ResultAcceptanceStore["accept"]>>> {
    const expiresAtMs = this.#futureExpiry(input.expiresAt, now);
    if (
      expiresAtMs === undefined ||
      !input.resultId ||
      input.resultId.length > 200 ||
      !input.operationId ||
      input.operationId.length > 512 ||
      !/^sha256:[A-Za-z0-9_-]{43}$/u.test(input.requestDigest)
    ) {
      return "replay";
    }
    const value = canonicalJson({
      operationId: input.operationId,
      requestDigest: input.requestDigest,
    });
    const response = await this.#client.sendCommand([
      "EVAL",
      ACCEPT_RESULT_SCRIPT,
      "1",
      this.#key("acceptance", input.resultId),
      value,
      String(expiresAtMs),
    ]);
    if (response === 1 || response === "1") return "new";
    if (response === 2 || response === "2") return "same_operation";
    return "replay";
  }

  async #acceptResultWithLegacy(
    input: Parameters<ResultAcceptanceStore["accept"]>[0],
    legacyResultId: string,
    now = new Date(),
  ): Promise<Awaited<ReturnType<ResultAcceptanceStore["accept"]>>> {
    const expiresAtMs = this.#futureExpiry(input.expiresAt, now);
    if (
      expiresAtMs === undefined ||
      !input.resultId ||
      input.resultId.length > 200 ||
      !legacyResultId ||
      legacyResultId.length > 200 ||
      !input.operationId ||
      input.operationId.length > 512 ||
      !/^sha256:[A-Za-z0-9_-]{43}$/u.test(input.requestDigest)
    ) {
      return "replay";
    }
    const value = canonicalJson({
      operationId: input.operationId,
      requestDigest: input.requestDigest,
    });
    const response = await this.#client.sendCommand([
      "EVAL",
      ACCEPT_RESULT_WITH_LEGACY_SCRIPT,
      "2",
      this.#key("acceptance", input.resultId),
      this.#key("acceptance", legacyResultId),
      value,
      String(expiresAtMs),
    ]);
    if (response === 1 || response === "1") return "new";
    if (response === 2 || response === "2") return "same_operation";
    return "replay";
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
    kind: "nonce" | "provider" | "requirement" | "result" | "acceptance",
    id: string,
  ): string {
    if (!id) throw new Error("x424 store ID is required");
    return `${this.#prefix}:${kind}:${id}`;
  }
}

/** Durable, atomic brokered-handoff state using the same Redis command surface. */
export class RedisHandoffStore implements HandoffStore {
  readonly #client: RedisCommandClient;
  readonly #prefix: string;

  constructor(options: RedisX424StoreOptions) {
    this.#client = options.client;
    this.#prefix = options.keyPrefix ?? "x424";
  }

  async create(record: StoredHumanHandoff): Promise<boolean> {
    const expiresAtMs = Date.parse(record.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now())
      return false;
    const response = await this.#client.sendCommand([
      "EVAL",
      CREATE_HANDOFF_SCRIPT,
      "2",
      this.#recordKey(record.handoffId),
      this.#dependencyKey(record.dependencyId),
      canonicalJson(record),
      String(expiresAtMs),
      record.handoffId,
    ]);
    return response === 1 || response === "1";
  }

  async getAuthorized(
    handoffId: string,
    accessTokenDigest: string,
    now = new Date(),
  ): Promise<StoredHumanHandoff | undefined> {
    const value = await this.#client.sendCommand([
      "GET",
      this.#recordKey(handoffId),
    ]);
    if (typeof value !== "string") return undefined;
    const record = parseStoredHumanHandoff(value);
    if (record.accessTokenDigest !== accessTokenDigest) return undefined;
    if (
      Date.parse(record.expiresAt) <= now.getTime() &&
      !handoffTerminal(record.status)
    ) {
      const expired: StoredHumanHandoff = {
        ...record,
        status: "expired",
        version: record.version + 1,
      };
      if (await this.update(record, expired)) return expired;
      return this.getAuthorized(handoffId, accessTokenDigest, now);
    }
    return record;
  }

  async update(
    previous: StoredHumanHandoff,
    next: StoredHumanHandoff,
  ): Promise<boolean> {
    if (next.version !== previous.version + 1) return false;
    const expiresAtMs = Date.parse(next.expiresAt);
    if (!Number.isFinite(expiresAtMs)) return false;
    const response = await this.#client.sendCommand([
      "EVAL",
      UPDATE_HANDOFF_SCRIPT,
      "2",
      this.#recordKey(previous.handoffId),
      this.#dependencyKey(previous.dependencyId),
      canonicalJson(previous),
      canonicalJson(next),
      String(Math.max(Date.now() + 1_000, expiresAtMs)),
      handoffTerminal(next.status) ? "1" : "0",
      previous.handoffId,
    ]);
    return response === 1 || response === "1";
  }

  #recordKey(handoffId: string): string {
    return `${this.#prefix}:handoff:${handoffId}`;
  }

  #dependencyKey(dependencyId: string): string {
    return `${this.#prefix}:handoff-dependency:${dependencyId}`;
  }
}

function handoffTerminal(status: StoredHumanHandoff["status"]): boolean {
  return ["completed", "failed", "expired", "cancelled"].includes(status);
}
