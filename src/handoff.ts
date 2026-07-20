import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { canonicalJson, sha256 } from "./canonical.js";
import { encodeStrictBase64Url, decodeStrictBase64Url } from "./encoding.js";
import { methodKey } from "./catalog.js";
import type { X424Service } from "./service.js";
import type {
  HumanMethodRequirement,
  HumanProofSubmission,
  HumanRequirement,
  RequirementStore,
} from "./types.js";

export type HumanHandoffStatus =
  "pending" | "completed" | "failed" | "expired" | "cancelled";

export interface HumanHandoffPresentation {
  readonly kind: "uri";
  readonly uri: string;
  readonly userCode?: string;
}

export type HumanHandoffEvent =
  | {
      readonly type: "human_action_required";
      readonly handoffId: string;
      readonly providerId: string;
      readonly methodId: string;
      readonly presentation: HumanHandoffPresentation;
      readonly expiresAt: string;
    }
  | { readonly type: "waiting"; readonly handoffId: string }
  | { readonly type: "completed"; readonly handoffId: string }
  | {
      readonly type: "failed";
      readonly handoffId: string;
      readonly code: string;
    }
  | { readonly type: "expired"; readonly handoffId: string }
  | { readonly type: "cancelled"; readonly handoffId: string };

export interface HumanHandoffPresenter {
  present(event: HumanHandoffEvent): void | Promise<void>;
}

export interface HumanProviderHandoffAdapter {
  readonly providerId: string;
  readonly methodIds: readonly string[];
  startHandoff(input: {
    readonly requirement: HumanRequirement;
    readonly acceptedMethod: HumanMethodRequirement;
    readonly providerRequest: unknown;
  }): Promise<{
    /** Must be serializable. It is encrypted before durable storage. */
    readonly providerSession: unknown;
    readonly presentation: HumanHandoffPresentation;
    readonly expiresAt: string;
    readonly pollAfterMs?: number;
  }>;
  pollHandoff(input: {
    readonly providerSession: unknown;
  }): Promise<
    | { readonly status: "pending" }
    | { readonly status: "completed"; readonly nativeProof: unknown }
    | { readonly status: "failed"; readonly code: string }
  >;
  cancelHandoff?(input: { readonly providerSession: unknown }): Promise<void>;
}

export interface HandoffStateProtector {
  protect(value: unknown): Promise<string> | string;
  unprotect(value: string): Promise<unknown> | unknown;
}

/** AES-256-GCM envelope for provider session and completion state. */
export class AesGcmHandoffStateProtector implements HandoffStateProtector {
  readonly #key: Uint8Array;

  constructor(key: Uint8Array) {
    if (key.byteLength !== 32) {
      throw new Error("Handoff state key must be exactly 32 bytes");
    }
    this.#key = Uint8Array.from(key);
  }

  protect(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(canonicalJson(value), "utf8"),
      cipher.final(),
    ]);
    return [
      "x424-handoff-a256gcm-v1",
      encodeStrictBase64Url(iv),
      encodeStrictBase64Url(cipher.getAuthTag()),
      encodeStrictBase64Url(ciphertext),
    ].join(".");
  }

  unprotect(value: string): unknown {
    const [version, iv, tag, ciphertext, extra] = value.split(".");
    if (
      version !== "x424-handoff-a256gcm-v1" ||
      !iv ||
      !tag ||
      !ciphertext ||
      extra !== undefined
    ) {
      throw new Error("Invalid protected handoff state");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.#key,
      decodeStrictBase64Url(iv, "handoff iv"),
    );
    decipher.setAuthTag(decodeStrictBase64Url(tag, "handoff tag"));
    const plaintext = Buffer.concat([
      decipher.update(decodeStrictBase64Url(ciphertext, "handoff state")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as unknown;
  }
}

export interface StoredHumanHandoff {
  readonly handoffId: string;
  readonly dependencyId: string;
  readonly providerId: string;
  readonly methodId: string;
  readonly accessTokenDigest: string;
  readonly status: HumanHandoffStatus | "polling";
  /** Short lease that lets another verifier reclaim polling after process loss. */
  readonly pollClaimExpiresAt?: string;
  readonly presentation: HumanHandoffPresentation;
  readonly protectedState: string;
  readonly protectedCompletion?: string;
  readonly failureCode?: string;
  readonly pollAfterMs: number;
  readonly expiresAt: string;
  readonly version: number;
}

export interface HandoffStore {
  /** False means this dependency already has an active handoff. */
  create(record: StoredHumanHandoff): Promise<boolean>;
  getAuthorized(
    handoffId: string,
    accessTokenDigest: string,
    now?: Date,
  ): Promise<StoredHumanHandoff | undefined>;
  /** Atomic compare-and-swap. */
  update(
    previous: StoredHumanHandoff,
    next: StoredHumanHandoff,
  ): Promise<boolean>;
}

/** Strictly parse durable handoff state; corrupted shared state fails closed. */
export function parseStoredHumanHandoff(value: unknown): StoredHumanHandoff {
  const parsed =
    typeof value === "string"
      ? (JSON.parse(value) as Partial<StoredHumanHandoff>)
      : (value as Partial<StoredHumanHandoff> | null);
  const statuses = [
    "pending",
    "polling",
    "completed",
    "failed",
    "expired",
    "cancelled",
  ];
  if (
    !parsed ||
    typeof parsed.handoffId !== "string" ||
    typeof parsed.dependencyId !== "string" ||
    typeof parsed.providerId !== "string" ||
    typeof parsed.methodId !== "string" ||
    typeof parsed.accessTokenDigest !== "string" ||
    typeof parsed.status !== "string" ||
    !statuses.includes(parsed.status) ||
    parsed.presentation?.kind !== "uri" ||
    typeof parsed.presentation.uri !== "string" ||
    typeof parsed.protectedState !== "string" ||
    typeof parsed.pollAfterMs !== "number" ||
    !Number.isInteger(parsed.pollAfterMs) ||
    parsed.pollAfterMs < 500 ||
    parsed.pollAfterMs > 10_000 ||
    typeof parsed.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(parsed.expiresAt)) ||
    typeof parsed.version !== "number" ||
    !Number.isInteger(parsed.version) ||
    parsed.version < 1 ||
    (parsed.pollClaimExpiresAt !== undefined &&
      !Number.isFinite(Date.parse(parsed.pollClaimExpiresAt)))
  ) {
    throw new Error("Invalid durable handoff state");
  }
  return parsed as StoredHumanHandoff;
}

/** Reference store; durable deployments use the Redis/PostgreSQL adapters. */
export class InMemoryHandoffStore implements HandoffStore {
  readonly #records = new Map<string, StoredHumanHandoff>();
  readonly #activeDependencies = new Map<string, string>();

  async create(record: StoredHumanHandoff): Promise<boolean> {
    if (
      this.#records.has(record.handoffId) ||
      this.#activeDependencies.has(record.dependencyId)
    ) {
      return false;
    }
    this.#records.set(record.handoffId, structuredClone(record));
    this.#activeDependencies.set(record.dependencyId, record.handoffId);
    return true;
  }

  async getAuthorized(
    handoffId: string,
    accessTokenDigest: string,
    now = new Date(),
  ): Promise<StoredHumanHandoff | undefined> {
    const record = this.#records.get(handoffId);
    if (!record || record.accessTokenDigest !== accessTokenDigest) {
      return undefined;
    }
    if (
      Date.parse(record.expiresAt) <= now.getTime() &&
      record.status !== "completed" &&
      record.status !== "failed" &&
      record.status !== "cancelled" &&
      record.status !== "expired"
    ) {
      const expired = {
        ...record,
        status: "expired" as const,
        version: record.version + 1,
      };
      this.#records.set(handoffId, expired);
      this.#activeDependencies.delete(record.dependencyId);
      return structuredClone(expired);
    }
    return structuredClone(record);
  }

  async update(
    previous: StoredHumanHandoff,
    next: StoredHumanHandoff,
  ): Promise<boolean> {
    const current = this.#records.get(previous.handoffId);
    if (
      !current ||
      current.version !== previous.version ||
      current.accessTokenDigest !== previous.accessTokenDigest ||
      next.version !== previous.version + 1
    ) {
      return false;
    }
    this.#records.set(next.handoffId, structuredClone(next));
    if (["completed", "failed", "expired", "cancelled"].includes(next.status)) {
      this.#activeDependencies.delete(next.dependencyId);
    }
    return true;
  }
}

export interface StartHumanHandoffInput {
  readonly dependencyId: string;
  readonly nonce: string;
  readonly providerId: string;
  readonly methodId: string;
}

export interface StartedHumanHandoff {
  readonly handoffId: string;
  readonly accessToken: string;
  readonly status: "pending";
  readonly providerId: string;
  readonly methodId: string;
  readonly presentation: HumanHandoffPresentation;
  readonly expiresAt: string;
  readonly pollAfterMs: number;
}

export type HumanHandoffView =
  | {
      readonly handoffId: string;
      readonly status: "pending";
      readonly pollAfterMs: number;
      readonly expiresAt: string;
    }
  | {
      readonly handoffId: string;
      readonly status: "completed";
      readonly humanProof: string;
      readonly expiresAt: string;
    }
  | {
      readonly handoffId: string;
      readonly status: "failed";
      readonly code: string;
      readonly expiresAt: string;
    }
  | {
      readonly handoffId: string;
      readonly status: "expired" | "cancelled";
      readonly expiresAt: string;
    };

export class HumanHandoffService {
  readonly #service: X424Service;
  readonly #requirements: RequirementStore;
  readonly #store: HandoffStore;
  readonly #protector: HandoffStateProtector;
  readonly #adapters: ReadonlyMap<string, HumanProviderHandoffAdapter>;
  readonly #now: () => Date;

  constructor(options: {
    readonly service: X424Service;
    readonly requirementStore: RequirementStore;
    readonly store: HandoffStore;
    readonly protector: HandoffStateProtector;
    readonly adapters: readonly HumanProviderHandoffAdapter[];
    readonly now?: () => Date;
  }) {
    this.#service = options.service;
    this.#requirements = options.requirementStore;
    this.#store = options.store;
    this.#protector = options.protector;
    this.#now = options.now ?? (() => new Date());
    const adapters = new Map<string, HumanProviderHandoffAdapter>();
    for (const adapter of options.adapters) {
      if (adapters.has(adapter.providerId)) {
        throw new Error(`Duplicate handoff adapter: ${adapter.providerId}`);
      }
      adapters.set(adapter.providerId, adapter);
    }
    this.#adapters = adapters;
  }

  async start(input: StartHumanHandoffInput): Promise<StartedHumanHandoff> {
    const requirement = await this.#requirements.get(
      input.dependencyId,
      this.#now(),
    );
    if (!requirement || requirement.nonce !== input.nonce) {
      throw new Error("Unknown, expired, or mismatched human dependency");
    }
    const acceptedMethod = requirement.accepts.find(
      (candidate) =>
        candidate.providerId === input.providerId &&
        candidate.methodId === input.methodId,
    );
    if (!acceptedMethod) throw new Error("Human method is not accepted");
    const adapter = this.#adapters.get(input.providerId);
    if (!adapter || !adapter.methodIds.includes(input.methodId)) {
      throw new Error("Human handoff method is unavailable");
    }
    const key = methodKey(input.providerId, input.methodId);
    const started = await adapter.startHandoff({
      requirement,
      acceptedMethod,
      providerRequest: requirement.providerRequests?.[key],
    });
    const requirementExpiry = Date.parse(requirement.expiresAt);
    const providerExpiry = Date.parse(started.expiresAt);
    const expiresAt = new Date(
      Math.min(requirementExpiry, providerExpiry),
    ).toISOString();
    if (Date.parse(expiresAt) <= this.#now().getTime()) {
      throw new Error("Provider handoff already expired");
    }
    const handoffId = `x424_handoff_${randomUUID()}`;
    const accessToken = encodeStrictBase64Url(randomBytes(32));
    const record: StoredHumanHandoff = {
      handoffId,
      dependencyId: requirement.dependencyId,
      providerId: input.providerId,
      methodId: input.methodId,
      accessTokenDigest: sha256(accessToken),
      status: "pending",
      presentation: started.presentation,
      protectedState: await this.#protector.protect(started.providerSession),
      pollAfterMs: Math.max(
        500,
        Math.min(10_000, started.pollAfterMs ?? 1_000),
      ),
      expiresAt,
      version: 1,
    };
    if (!(await this.#store.create(record))) {
      throw new Error("Dependency already has an active handoff");
    }
    return {
      handoffId,
      accessToken,
      status: "pending",
      providerId: input.providerId,
      methodId: input.methodId,
      presentation: started.presentation,
      expiresAt,
      pollAfterMs: record.pollAfterMs,
    };
  }

  async poll(
    handoffId: string,
    accessToken: string,
  ): Promise<HumanHandoffView> {
    const digest = sha256(accessToken);
    let current = await this.#store.getAuthorized(
      handoffId,
      digest,
      this.#now(),
    );
    if (!current) throw new Error("Unknown handoff capability");
    const terminal = await this.#terminalView(current);
    if (terminal) return terminal;
    if (current.status === "polling") {
      const claimExpiresAt = Date.parse(current.pollClaimExpiresAt ?? "");
      if (
        Number.isFinite(claimExpiresAt) &&
        claimExpiresAt > this.#now().getTime()
      ) {
        return this.#pendingView(current);
      }
      const reclaimedState = withoutPollClaim(current);
      const reclaimed: StoredHumanHandoff = {
        ...reclaimedState,
        status: "pending",
        version: current.version + 1,
      };
      if (!(await this.#store.update(current, reclaimed))) {
        return this.#pendingView(current);
      }
      current = reclaimed;
    }
    const claimLifetimeMs = Math.max(10_000, current.pollAfterMs * 3);
    const claimed: StoredHumanHandoff = {
      ...current,
      status: "polling",
      pollClaimExpiresAt: new Date(
        Math.min(
          Date.parse(current.expiresAt),
          this.#now().getTime() + claimLifetimeMs,
        ),
      ).toISOString(),
      version: current.version + 1,
    };
    if (!(await this.#store.update(current, claimed))) {
      return this.#pendingView(current);
    }
    const adapter = this.#adapters.get(claimed.providerId);
    if (!adapter) {
      return this.#failClaimed(claimed, "HANDOFF_ADAPTER_UNAVAILABLE");
    }
    try {
      const providerSession = await this.#protector.unprotect(
        claimed.protectedState,
      );
      const provider = await adapter.pollHandoff({ providerSession });
      if (provider.status === "pending") {
        const pendingState = withoutPollClaim(claimed);
        const pending: StoredHumanHandoff = {
          ...pendingState,
          status: "pending",
          version: claimed.version + 1,
        };
        await this.#store.update(claimed, pending);
        return this.#pendingView(pending);
      }
      if (provider.status === "failed") {
        return this.#failClaimed(claimed, provider.code);
      }
      const requirement = await this.#requirements.get(
        claimed.dependencyId,
        this.#now(),
      );
      if (!requirement) {
        return this.#failClaimed(claimed, "DEPENDENCY_NOT_FOUND");
      }
      const proof: HumanProofSubmission = {
        x424Version: "0.1",
        dependencyId: requirement.dependencyId,
        providerId: claimed.providerId,
        methodId: claimed.methodId,
        binding: requirement.binding,
        nativeProof: provider.nativeProof,
      };
      const satisfied = await this.#service.satisfy({ requirement, proof });
      const completed: StoredHumanHandoff = {
        ...claimed,
        status: "completed",
        protectedCompletion: await this.#protector.protect({
          humanProof: satisfied.token,
        }),
        version: claimed.version + 1,
      };
      if (!(await this.#store.update(claimed, completed))) {
        throw new Error("Handoff completion lost its atomic state claim");
      }
      return {
        handoffId,
        status: "completed",
        humanProof: satisfied.token,
        expiresAt: completed.expiresAt,
      };
    } catch {
      return this.#failClaimed(claimed, "HANDOFF_POLL_FAILED");
    }
  }

  async cancel(handoffId: string, accessToken: string): Promise<boolean> {
    const digest = sha256(accessToken);
    const current = await this.#store.getAuthorized(
      handoffId,
      digest,
      this.#now(),
    );
    if (!current) return false;
    if (
      ["completed", "failed", "expired", "cancelled"].includes(current.status)
    ) {
      return current.status === "cancelled";
    }
    const adapter = this.#adapters.get(current.providerId);
    try {
      await adapter?.cancelHandoff?.({
        providerSession: await this.#protector.unprotect(
          current.protectedState,
        ),
      });
    } catch {
      // Cancellation is local and fail-closed even if the provider is down.
    }
    return this.#store.update(current, {
      ...current,
      status: "cancelled",
      version: current.version + 1,
    });
  }

  async #terminalView(
    record: StoredHumanHandoff,
  ): Promise<HumanHandoffView | undefined> {
    if (record.status === "completed") {
      const completion = await this.#protector.unprotect(
        record.protectedCompletion ?? "",
      );
      if (
        typeof completion !== "object" ||
        completion === null ||
        !("humanProof" in completion) ||
        typeof completion.humanProof !== "string"
      ) {
        throw new Error("Invalid protected handoff completion");
      }
      return {
        handoffId: record.handoffId,
        status: "completed",
        humanProof: completion.humanProof,
        expiresAt: record.expiresAt,
      };
    }
    if (record.status === "failed") {
      return {
        handoffId: record.handoffId,
        status: "failed",
        code: record.failureCode ?? "HANDOFF_FAILED",
        expiresAt: record.expiresAt,
      };
    }
    if (record.status === "expired" || record.status === "cancelled") {
      return {
        handoffId: record.handoffId,
        status: record.status,
        expiresAt: record.expiresAt,
      };
    }
    return undefined;
  }

  #pendingView(record: StoredHumanHandoff): HumanHandoffView {
    return {
      handoffId: record.handoffId,
      status: "pending",
      pollAfterMs: record.pollAfterMs,
      expiresAt: record.expiresAt,
    };
  }

  async #failClaimed(
    claimed: StoredHumanHandoff,
    code: string,
  ): Promise<HumanHandoffView> {
    const failed: StoredHumanHandoff = {
      ...claimed,
      status: "failed",
      failureCode: code.replace(/[^A-Z0-9_]/gu, "_").slice(0, 100),
      version: claimed.version + 1,
    };
    await this.#store.update(claimed, failed);
    return {
      handoffId: failed.handoffId,
      status: "failed",
      code: failed.failureCode!,
      expiresAt: failed.expiresAt,
    };
  }
}

function withoutPollClaim(
  record: StoredHumanHandoff,
): Omit<StoredHumanHandoff, "pollClaimExpiresAt"> {
  const copy = { ...record };
  delete copy.pollClaimExpiresAt;
  return copy;
}
