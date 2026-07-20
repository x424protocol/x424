import type { IsoTimestamp, NonceStore, ResultReplayStore } from "./types.js";

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
