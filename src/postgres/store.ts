/**
 * PostgreSQL transactional state profile (P2-04).
 * Adopters inject a minimal query client; x424 does not bundle a driver.
 */

import { canonicalJson, sha256 } from "../canonical.js";
import { parseHumanRequirement } from "../schemas.js";
import type {
  HumanRequirement,
  IsoTimestamp,
  NonceStore,
  ProviderReplayEntry,
  ProviderReplayStore,
  RequirementStore,
  ResultReplayStore,
} from "../types.js";

export interface PostgresQueryResult {
  readonly rowCount: number | null;
  readonly rows: readonly Record<string, unknown>[];
}

export interface PostgresQueryClient {
  query(
    text: string,
    params?: readonly unknown[],
  ): Promise<PostgresQueryResult>;
}

export interface PostgresX424StoreOptions {
  readonly client: PostgresQueryClient;
  readonly schema?: string;
}

function ttlSeconds(expiresAt: IsoTimestamp, now = new Date()): number {
  const ms = Date.parse(expiresAt) - now.getTime();
  return Math.max(1, Math.ceil(ms / 1_000));
}

/**
 * Apply schema DDL once at deploy time. Safe to re-run (IF NOT EXISTS).
 */
export const POSTGRES_X424_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS x424_nonces (
  dependency_id TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS x424_requirements (
  dependency_id TEXT PRIMARY KEY,
  document JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS x424_provider_subjects (
  digest TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS x424_results (
  result_id TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);
`;

export class PostgresX424Store {
  readonly #client: PostgresQueryClient;
  readonly nonces: NonceStore;
  readonly providers: ProviderReplayStore;
  readonly requirements: RequirementStore;
  readonly results: ResultReplayStore;

  constructor(options: PostgresX424StoreOptions) {
    this.#client = options.client;
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

  async migrate(): Promise<void> {
    await this.#client.query(POSTGRES_X424_SCHEMA_SQL);
  }

  async #putNonce(
    dependencyId: string,
    nonce: string,
    expiresAt: IsoTimestamp,
  ): Promise<void> {
    if (!nonce) throw new Error("Invalid nonce entry");
    const result = await this.#client.query(
      `INSERT INTO x424_nonces (dependency_id, nonce, expires_at)
       VALUES ($1, $2, $3::timestamptz)
       ON CONFLICT (dependency_id) DO NOTHING
       RETURNING dependency_id`,
      [dependencyId, nonce, expiresAt],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new Error("Dependency ID already exists");
    }
  }

  async #consumeNonce(dependencyId: string, nonce: string): Promise<boolean> {
    const result = await this.#client.query(
      `DELETE FROM x424_nonces
       WHERE dependency_id = $1 AND nonce = $2 AND expires_at > NOW()
       RETURNING dependency_id`,
      [dependencyId, nonce],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async #putRequirement(requirement: HumanRequirement): Promise<void> {
    const result = await this.#client.query(
      `INSERT INTO x424_requirements (dependency_id, document, expires_at)
       VALUES ($1, $2::jsonb, $3::timestamptz)
       ON CONFLICT (dependency_id) DO NOTHING
       RETURNING dependency_id`,
      [
        requirement.dependencyId,
        canonicalJson(requirement),
        requirement.expiresAt,
      ],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new Error("Dependency ID already exists");
    }
  }

  async #getRequirement(
    dependencyId: string,
    now = new Date(),
  ): Promise<HumanRequirement | undefined> {
    const result = await this.#client.query(
      `SELECT document, expires_at FROM x424_requirements
       WHERE dependency_id = $1`,
      [dependencyId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const expiresAt = Date.parse(String(row.expires_at));
    if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
      await this.#deleteRequirement(dependencyId);
      return undefined;
    }
    return parseHumanRequirement(row.document);
  }

  async #deleteRequirement(dependencyId: string): Promise<void> {
    await this.#client.query(
      `DELETE FROM x424_requirements WHERE dependency_id = $1`,
      [dependencyId],
    );
  }

  async #consumeProvider(entry: ProviderReplayEntry): Promise<boolean> {
    // Provider-subject retention is durable until explicit purge; TTL cleanup
    // is an operator concern. Digest is the only stored identifier.
    const result = await this.#client.query(
      `INSERT INTO x424_provider_subjects (digest, expires_at)
       VALUES ($1, NOW() + INTERVAL '365 days')
       ON CONFLICT (digest) DO NOTHING
       RETURNING digest`,
      [
        sha256(
          [
            entry.providerId,
            entry.methodId,
            entry.uniquenessScope.kind,
            entry.uniquenessScope.id,
            entry.subjectDigest,
          ].join("\u0000"),
        ),
      ],
    );
    void ttlSeconds;
    return (result.rowCount ?? 0) > 0;
  }

  async #consumeResult(
    resultId: string,
    expiresAt: IsoTimestamp,
    now = new Date(),
  ): Promise<boolean> {
    if (Date.parse(expiresAt) <= now.getTime()) return false;
    const result = await this.#client.query(
      `INSERT INTO x424_results (result_id, expires_at)
       VALUES ($1, $2::timestamptz)
       ON CONFLICT (result_id) DO NOTHING
       RETURNING result_id`,
      [resultId, expiresAt],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
