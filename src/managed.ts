/**
 * Public managed-verifier client. The hosted control plane is intentionally a
 * separate implementation and receives no privileged x424 behavior.
 */

import { encodeStrictBase64Url } from "./encoding.js";
import { parseHumanRequirement } from "./schemas.js";
import { assertTrustedHttpsUrl, isCrossOriginRedirect } from "./transport.js";
import type {
  HumanHandoffView,
  StartHumanHandoffInput,
  StartedHumanHandoff,
} from "./handoff.js";
import type {
  RequirementIssuanceInput,
  RequirementIssuer,
} from "./middleware/resource.js";
import type {
  HumanRequirement,
  IsoTimestamp,
  RequirementStore,
  ResultAcceptanceInput,
  ResultAcceptanceStatus,
  ResultAcceptanceStore,
  ResultReplayStore,
} from "./types.js";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_RESPONSE_BYTES = 1_048_576;

async function readBoundedResponse(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        throw new Error("Managed verifier response is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
    "utf8",
  );
}

export interface ManagedVerifierClientOptions {
  readonly baseUrl: string | URL;
  readonly fetchImplementation?: typeof fetch;
  readonly headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  /** Development only. HTTPS is required otherwise. */
  readonly allowHttpLocalhost?: boolean;
}

interface ManagedResponseOptions {
  readonly allowNotFound?: boolean;
  readonly expectedStatuses: readonly number[];
}

function wireBodyInput(input: RequirementIssuanceInput["bodyInput"]): unknown {
  if (input.kind !== "opaque") return input;
  return {
    kind: "opaque",
    bytesBase64url: encodeStrictBase64Url(input.bytes),
  };
}

/**
 * Authenticated client for public managed-verifier runtime APIs. Redirects and
 * cross-origin responses fail closed so credentials and private state cannot
 * be redirected to another operator.
 */
export class ManagedVerifierClient implements RequirementIssuer {
  readonly #base: URL;
  readonly #fetch: typeof fetch;
  readonly #headers?: ManagedVerifierClientOptions["headers"];

  constructor(options: ManagedVerifierClientOptions) {
    const base = assertTrustedHttpsUrl(
      options.baseUrl,
      options.allowHttpLocalhost === true,
    );
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    this.#base = base;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#headers = options.headers;
  }

  async issueRequirement(
    input: RequirementIssuanceInput,
  ): Promise<HumanRequirement> {
    const value = await this.#requestJson(
      "v1/requirements",
      {
        method: "POST",
        body: JSON.stringify({
          ...input,
          bodyInput: wireBodyInput(input.bodyInput),
        }),
      },
      { expectedStatuses: [201] },
    );
    if (!isRecord(value) || value.requirement === undefined) {
      throw new Error(
        "Managed verifier returned an invalid requirement response",
      );
    }
    return parseHumanRequirement(value.requirement);
  }

  async getRequirement(
    dependencyId: string,
  ): Promise<HumanRequirement | undefined> {
    const value = await this.#requestJson(
      `v1/requirements/${encodeURIComponent(dependencyId)}`,
      { method: "GET" },
      { expectedStatuses: [200], allowNotFound: true },
    );
    if (value === undefined) return undefined;
    if (!isRecord(value) || value.requirement === undefined) {
      throw new Error("Managed verifier returned an invalid state response");
    }
    return parseHumanRequirement(value.requirement);
  }

  async deleteRequirement(dependencyId: string): Promise<void> {
    await this.#requestJson(
      `v1/requirements/${encodeURIComponent(dependencyId)}`,
      { method: "DELETE" },
      { expectedStatuses: [200, 204], allowNotFound: true },
    );
  }

  async consumeResult(
    resultId: string,
    expiresAt: IsoTimestamp,
  ): Promise<boolean> {
    const value = await this.#requestJson(
      `v1/results/${encodeURIComponent(resultId)}/consume`,
      { method: "POST", body: JSON.stringify({ expiresAt }) },
      { expectedStatuses: [200] },
    );
    if (!isRecord(value) || typeof value.consumed !== "boolean") {
      throw new Error("Managed verifier returned an invalid consume response");
    }
    return value.consumed;
  }

  async acceptResult(
    input: ResultAcceptanceInput,
  ): Promise<ResultAcceptanceStatus> {
    const value = await this.#requestJson(
      `v1/results/${encodeURIComponent(input.resultId)}/acceptances`,
      {
        method: "POST",
        body: JSON.stringify({
          operationId: input.operationId,
          requestDigest: input.requestDigest,
          expiresAt: input.expiresAt,
        }),
      },
      { expectedStatuses: [200] },
    );
    if (
      !isRecord(value) ||
      (value.status !== "new" &&
        value.status !== "same_operation" &&
        value.status !== "replay")
    ) {
      throw new Error(
        "Managed verifier returned an invalid acceptance response",
      );
    }
    return value.status;
  }

  async startHandoff(
    input: StartHumanHandoffInput,
  ): Promise<StartedHumanHandoff> {
    const value = await this.#requestJson(
      `v1/requirements/${encodeURIComponent(input.dependencyId)}/handoffs`,
      {
        method: "POST",
        body: JSON.stringify({
          nonce: input.nonce,
          providerId: input.providerId,
          methodId: input.methodId,
        }),
      },
      { expectedStatuses: [201] },
    );
    if (
      !isRecord(value) ||
      typeof value.handoffId !== "string" ||
      typeof value.accessToken !== "string" ||
      value.status !== "pending" ||
      typeof value.providerId !== "string" ||
      typeof value.methodId !== "string" ||
      !isRecord(value.presentation) ||
      value.presentation.kind !== "uri" ||
      typeof value.presentation.uri !== "string" ||
      typeof value.expiresAt !== "string" ||
      typeof value.pollAfterMs !== "number"
    ) {
      throw new Error("Managed verifier returned an invalid handoff response");
    }
    return value as unknown as StartedHumanHandoff;
  }

  async getHandoff(
    handoffId: string,
    accessToken: string,
  ): Promise<HumanHandoffView> {
    const value = await this.#requestJson(
      `v1/handoffs/${encodeURIComponent(handoffId)}`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` },
      },
      { expectedStatuses: [200] },
    );
    if (
      !isRecord(value) ||
      typeof value.handoffId !== "string" ||
      typeof value.status !== "string" ||
      typeof value.expiresAt !== "string" ||
      !["pending", "completed", "failed", "expired", "cancelled"].includes(
        value.status,
      )
    ) {
      throw new Error("Managed verifier returned an invalid handoff state");
    }
    return value as unknown as HumanHandoffView;
  }

  async cancelHandoff(handoffId: string, accessToken: string): Promise<void> {
    await this.#requestJson(
      `v1/handoffs/${encodeURIComponent(handoffId)}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${accessToken}` },
      },
      { expectedStatuses: [204], allowNotFound: true },
    );
  }

  /** Fetch authenticated signed metadata; callers verify it with pinned keys. */
  async getMetadataToken(): Promise<string> {
    const value = await this.#requestJson(
      ".well-known/x424-verifier",
      { method: "GET" },
      { expectedStatuses: [200] },
    );
    if (!isRecord(value) || typeof value.token !== "string" || !value.token) {
      throw new Error("Managed verifier returned invalid metadata");
    }
    return value.token;
  }

  requirementStore(): RequirementStore {
    return Object.freeze({
      put: async () => {
        throw new Error(
          "Managed requirements must be created through issueRequirement",
        );
      },
      get: (dependencyId: string) => this.getRequirement(dependencyId),
      delete: (dependencyId: string) => this.deleteRequirement(dependencyId),
    });
  }

  resultReplayStore(): ResultReplayStore {
    return Object.freeze({
      consume: (resultId: string, expiresAt: IsoTimestamp) =>
        this.consumeResult(resultId, expiresAt),
    });
  }

  resultAcceptanceStore(): ResultAcceptanceStore {
    return Object.freeze({
      accept: (input: ResultAcceptanceInput) => this.acceptResult(input),
    });
  }

  async #requestJson(
    path: string,
    init: RequestInit,
    options: ManagedResponseOptions,
  ): Promise<unknown | undefined> {
    const endpoint = new URL(path, this.#base);
    if (endpoint.origin !== this.#base.origin) {
      throw new Error(
        "Managed verifier endpoint escaped the configured origin",
      );
    }
    const configuredHeaders =
      typeof this.#headers === "function"
        ? await this.#headers()
        : this.#headers;
    const headers = new Headers(configuredHeaders);
    const requestHeaders = new Headers(init.headers);
    for (const [key, value] of requestHeaders) headers.set(key, value);
    headers.set("accept", "application/json");
    if (init.body !== undefined)
      headers.set("content-type", "application/json");
    const response = await this.#fetch(
      new Request(endpoint, {
        ...init,
        headers,
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
      }),
    );
    if (
      response.type === "opaqueredirect" ||
      REDIRECT_STATUSES.has(response.status) ||
      isCrossOriginRedirect(endpoint.href, response.headers.get("location"))
    ) {
      throw new Error("Managed verifier redirects are not permitted");
    }
    if (new URL(response.url || endpoint.href).origin !== this.#base.origin) {
      throw new Error("Managed verifier response origin is not configured");
    }
    if (options.allowNotFound && response.status === 404) return undefined;
    if (!options.expectedStatuses.includes(response.status)) {
      throw new Error(`Managed verifier request failed (${response.status})`);
    }
    if (response.status === 204) return undefined;
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new Error("Managed verifier response is too large");
    }
    const text = await readBoundedResponse(response);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("Managed verifier returned invalid JSON");
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
