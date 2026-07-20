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
  ResultAcceptanceStore,
  ResultReplayStore,
} from "../types.js";
import {
  parseStoredHumanHandoff,
  type HandoffStore,
  type StoredHumanHandoff,
} from "../handoff.js";

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
CREATE TABLE IF NOT EXISTS x424_result_acceptances (
  result_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS x424_handoffs (
  handoff_id TEXT PRIMARY KEY,
  dependency_id TEXT NOT NULL,
  access_token_digest TEXT NOT NULL,
  status TEXT NOT NULL,
  active BOOLEAN NOT NULL,
  version INTEGER NOT NULL,
  document JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS x424_handoffs_one_active_dependency
  ON x424_handoffs (dependency_id) WHERE active;
`;

export class PostgresX424Store {
  readonly #client: PostgresQueryClient;
  readonly nonces: NonceStore;
  readonly providers: ProviderReplayStore;
  readonly requirements: RequirementStore;
  readonly results: ResultReplayStore;
  readonly resultAcceptances: ResultAcceptanceStore;
  readonly handoffs: HandoffStore;

  constructor(options: PostgresX424StoreOptions) {
    this.#client = options.client;
    this.handoffs = new PostgresHandoffStore(options);
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
    this.resultAcceptances = Object.freeze({
      accept: (
        input: Parameters<ResultAcceptanceStore["accept"]>[0],
        now?: Date,
      ) => this.#acceptResult(input, now),
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

  async #acceptResult(
    input: Parameters<ResultAcceptanceStore["accept"]>[0],
    now = new Date(),
  ): Promise<Awaited<ReturnType<ResultAcceptanceStore["accept"]>>> {
    if (
      !input.resultId ||
      input.resultId.length > 200 ||
      !input.operationId ||
      input.operationId.length > 512 ||
      !/^sha256:[A-Za-z0-9_-]{43}$/u.test(input.requestDigest) ||
      Date.parse(input.expiresAt) <= now.getTime()
    ) {
      return "replay";
    }
    const result = await this.#client.query(
      `WITH inserted AS (
         INSERT INTO x424_result_acceptances
           (result_id, operation_id, request_digest, expires_at)
         VALUES ($1, $2, $3, $4::timestamptz)
         ON CONFLICT (result_id) DO NOTHING
         RETURNING result_id
       )
       SELECT CASE
         WHEN EXISTS (SELECT 1 FROM inserted) THEN 'new'
         WHEN EXISTS (
           SELECT 1 FROM x424_result_acceptances
           WHERE result_id = $1 AND operation_id = $2 AND request_digest = $3
             AND expires_at > NOW()
         ) THEN 'same_operation'
         ELSE 'replay'
       END AS status`,
      [input.resultId, input.operationId, input.requestDigest, input.expiresAt],
    );
    const status = result.rows[0]?.status;
    return status === "new" || status === "same_operation" ? status : "replay";
  }
}

/** PostgreSQL compare-and-swap handoff state for horizontally scaled verifiers. */
export class PostgresHandoffStore implements HandoffStore {
  readonly #client: PostgresQueryClient;

  constructor(options: PostgresX424StoreOptions) {
    this.#client = options.client;
  }

  async create(record: StoredHumanHandoff): Promise<boolean> {
    const result = await this.#client.query(
      `INSERT INTO x424_handoffs
        (handoff_id, dependency_id, access_token_digest, status, active,
         version, document, expires_at)
       VALUES ($1, $2, $3, $4, TRUE, $5, $6::jsonb, $7::timestamptz)
       ON CONFLICT DO NOTHING
       RETURNING handoff_id`,
      [
        record.handoffId,
        record.dependencyId,
        record.accessTokenDigest,
        record.status,
        record.version,
        canonicalJson(record),
        record.expiresAt,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getAuthorized(
    handoffId: string,
    accessTokenDigest: string,
    now = new Date(),
  ): Promise<StoredHumanHandoff | undefined> {
    const result = await this.#client.query(
      `SELECT document FROM x424_handoffs
       WHERE handoff_id = $1 AND access_token_digest = $2`,
      [handoffId, accessTokenDigest],
    );
    const document = result.rows[0]?.document;
    if (!document) return undefined;
    const record = parseStoredHumanHandoff(document);
    if (
      Date.parse(record.expiresAt) <= now.getTime() &&
      !postgresHandoffTerminal(record.status)
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
    const result = await this.#client.query(
      `UPDATE x424_handoffs
       SET status = $1, active = $2, version = $3, document = $4::jsonb,
           expires_at = $5::timestamptz
       WHERE handoff_id = $6 AND access_token_digest = $7 AND version = $8
       RETURNING handoff_id`,
      [
        next.status,
        !postgresHandoffTerminal(next.status),
        next.version,
        canonicalJson(next),
        next.expiresAt,
        previous.handoffId,
        previous.accessTokenDigest,
        previous.version,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }
}

function postgresHandoffTerminal(
  status: StoredHumanHandoff["status"],
): boolean {
  return ["completed", "failed", "expired", "cancelled"].includes(status);
}
