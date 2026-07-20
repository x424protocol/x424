import type {
  IsoTimestamp,
  NonceStore,
  ProviderReplayEntry,
  ProviderReplayStore,
  ResultAcceptanceInput,
  ResultAcceptanceStore,
  ResultAcceptanceStatus,
  ResultReplayStore,
} from "./types.js";

interface NonceEntry {
  readonly nonce: string;
  readonly expiresAtMs: number;
  used: boolean;
}

/** Development/reference store. Production deployments need shared atomic state. */
export class InMemoryNonceStore implements NonceStore {
  readonly #entries = new Map<string, NonceEntry>();

  async put(
    dependencyId: string,
    nonce: string,
    expiresAt: IsoTimestamp,
  ): Promise<void> {
    const expiresAtMs = Date.parse(expiresAt);
    if (!dependencyId || !nonce || !Number.isFinite(expiresAtMs)) {
      throw new Error("Invalid nonce entry");
    }
    if (this.#entries.has(dependencyId)) {
      throw new Error("Dependency ID already exists");
    }
    this.#entries.set(dependencyId, { nonce, expiresAtMs, used: false });
  }

  async consume(
    dependencyId: string,
    nonce: string,
    now = new Date(),
  ): Promise<boolean> {
    const entry = this.#entries.get(dependencyId);
    if (
      !entry ||
      entry.used ||
      entry.nonce !== nonce ||
      entry.expiresAtMs <= now.getTime()
    ) {
      return false;
    }
    entry.used = true;
    return true;
  }
}

/** Development/reference replay store. Production needs shared atomic state. */
export class InMemoryResultReplayStore implements ResultReplayStore {
  readonly #used = new Map<string, number>();

  async consume(
    resultId: string,
    expiresAt: IsoTimestamp,
    now = new Date(),
  ): Promise<boolean> {
    const expiresAtMs = Date.parse(expiresAt);
    if (
      !resultId ||
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= now.getTime()
    ) {
      return false;
    }
    for (const [id, expiry] of this.#used) {
      if (expiry <= now.getTime()) this.#used.delete(id);
    }
    if (this.#used.has(resultId)) return false;
    this.#used.set(resultId, expiresAtMs);
    return true;
  }
}

interface ResultAcceptanceEntry {
  readonly operationId: string;
  readonly requestDigest: string;
  readonly expiresAtMs: number;
}

/** Development/reference acceptance store. Production needs shared atomic state. */
export class InMemoryResultAcceptanceStore implements ResultAcceptanceStore {
  readonly #accepted = new Map<string, ResultAcceptanceEntry>();

  async accept(
    input: ResultAcceptanceInput,
    now = new Date(),
  ): Promise<ResultAcceptanceStatus> {
    const expiresAtMs = Date.parse(input.expiresAt);
    if (
      !input.resultId ||
      input.resultId.length > 200 ||
      !input.operationId ||
      input.operationId.length > 512 ||
      !/^sha256:[A-Za-z0-9_-]{43}$/u.test(input.requestDigest) ||
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= now.getTime()
    ) {
      return "replay";
    }
    for (const [id, entry] of this.#accepted) {
      if (entry.expiresAtMs <= now.getTime()) this.#accepted.delete(id);
    }
    const existing = this.#accepted.get(input.resultId);
    if (existing) {
      return existing.operationId === input.operationId &&
        existing.requestDigest === input.requestDigest
        ? "same_operation"
        : "replay";
    }
    this.#accepted.set(input.resultId, {
      operationId: input.operationId,
      requestDigest: input.requestDigest,
      expiresAtMs,
    });
    return "new";
  }
}

/** Development/reference provider replay store. Production needs atomic state. */
export class InMemoryProviderReplayStore implements ProviderReplayStore {
  readonly #used = new Set<string>();

  async consume(entry: ProviderReplayEntry): Promise<boolean> {
    const key = [
      entry.providerId,
      entry.methodId,
      entry.uniquenessScope.kind,
      entry.uniquenessScope.id,
      entry.subjectDigest,
    ].join("\u0000");
    if (
      !entry.providerId ||
      !entry.methodId ||
      !entry.uniquenessScope.id ||
      !entry.subjectDigest ||
      this.#used.has(key)
    ) {
      return false;
    }
    this.#used.add(key);
    return true;
  }
}
