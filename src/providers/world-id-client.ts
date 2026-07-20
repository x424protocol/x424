import {
  IDKit,
  proofOfHuman,
  type IDKitResult,
  type WaitOptions,
} from "@worldcoin/idkit-core";
import type { ProviderProofResolver } from "../client.js";
import type { HumanProviderHandoffAdapter } from "../handoff.js";
import {
  createWorldIdProofResolver,
  type WorldIdProviderRequest,
} from "./world-id.js";

export interface WorldIdProofRequest {
  readonly connectorUri: string;
  readonly requestId: string;
  pollOnce(): Promise<{
    readonly type:
      | "waiting_for_connection"
      | "awaiting_confirmation"
      | "confirmed"
      | "failed";
    readonly result?: IDKitResult;
    readonly error?: string;
  }>;
  collect(options?: WaitOptions): Promise<IDKitResult>;
}

/** Build one IDKit Proof of Human ceremony from x424 provider material. */
export async function createWorldIdProofRequest(
  providerRequest: WorldIdProviderRequest,
): Promise<WorldIdProofRequest> {
  const request = await IDKit.request({
    app_id: providerRequest.appId as `app_${string}`,
    action: providerRequest.action,
    rp_context: providerRequest.rpContext,
    // IDKit may return v4 Proof of Human or its v3 Orb fallback. The x424
    // resolver labels those as separate immutable methods after collection.
    allow_legacy_proofs: providerRequest.allowLegacyProofs,
    environment: providerRequest.environment,
  }).preset(proofOfHuman({ signal: providerRequest.signal }));

  return {
    connectorUri: request.connectorURI,
    requestId: request.requestId,
    pollOnce: () => request.pollOnce(),
    collect: async (options) => {
      const completion = await request.pollUntilCompletion(options);
      if (!completion.success) {
        throw new Error(`World ID proof failed (${completion.error})`);
      }
      return completion.result;
    },
  };
}

/**
 * World brokered handoff using IDKit's public request/poll surface.
 *
 * IDKit 4.2 does not expose a public API for reconstructing a bridge request
 * after process loss, so this adapter intentionally reports a lost session
 * instead of reaching into private bridge internals. Production operators must
 * drain active sessions during restart until World publishes resumable state.
 */
export function createWorldIdHandoffAdapter(
  options: {
    readonly maximumActiveSessions?: number;
    readonly now?: () => Date;
  } = {},
): HumanProviderHandoffAdapter {
  const sessions = new Map<
    string,
    { readonly request: WorldIdProofRequest; readonly expiresAtMs: number }
  >();
  const maximum = options.maximumActiveSessions ?? 10_000;
  const now = options.now ?? (() => new Date());
  const cleanupExpired = () => {
    const nowMs = now().getTime();
    for (const [requestId, session] of sessions) {
      if (session.expiresAtMs <= nowMs) sessions.delete(requestId);
    }
  };
  const adapter: HumanProviderHandoffAdapter = {
    providerId: "world",
    methodIds: ["proof-of-human", "orb-legacy"],
    async startHandoff({ providerRequest }) {
      cleanupExpired();
      if (sessions.size >= maximum) {
        throw new Error("World handoff capacity reached");
      }
      const request = await createWorldIdProofRequest(
        providerRequest as WorldIdProviderRequest,
      );
      const rpExpiresAt = (providerRequest as WorldIdProviderRequest).rpContext
        .expires_at;
      const expiresAtMs = rpExpiresAt * 1_000;
      const expiresAt = new Date(expiresAtMs).toISOString();
      if (Date.parse(expiresAt) <= now().getTime()) {
        throw new Error("World provider request already expired");
      }
      sessions.set(request.requestId, { request, expiresAtMs });
      return {
        providerSession: { requestId: request.requestId },
        presentation: { kind: "uri" as const, uri: request.connectorUri },
        expiresAt,
        pollAfterMs: 1_000,
      };
    },
    async pollHandoff({ providerSession }) {
      if (
        typeof providerSession !== "object" ||
        providerSession === null ||
        !("requestId" in providerSession) ||
        typeof providerSession.requestId !== "string"
      ) {
        return { status: "failed" as const, code: "INVALID_WORLD_SESSION" };
      }
      cleanupExpired();
      const session = sessions.get(providerSession.requestId);
      if (!session) {
        return { status: "failed" as const, code: "WORLD_SESSION_LOST" };
      }
      const status = await session.request.pollOnce();
      if (status.type === "confirmed" && status.result) {
        sessions.delete(providerSession.requestId);
        return { status: "completed" as const, nativeProof: status.result };
      }
      if (status.type === "failed") {
        sessions.delete(providerSession.requestId);
        return {
          status: "failed" as const,
          code: `WORLD_${String(status.error ?? "FAILED").toUpperCase()}`,
        };
      }
      return { status: "pending" as const };
    },
    async cancelHandoff({ providerSession }) {
      if (
        typeof providerSession === "object" &&
        providerSession !== null &&
        "requestId" in providerSession &&
        typeof providerSession.requestId === "string"
      ) {
        sessions.delete(providerSession.requestId);
      }
    },
  };
  return Object.freeze(adapter);
}

export interface WorldIdIdKitResolverOptions {
  /** Display, deep-link, or otherwise hand the connector URI to the human. */
  readonly onConnectorUri?: (input: {
    readonly connectorUri: string;
    readonly providerRequest: WorldIdProviderRequest;
  }) => void | Promise<void>;
  readonly wait?: WaitOptions;
}

/**
 * Complete the World provider ceremony with IDKit and return the exact native
 * proof shape expected by the x424 verifier.
 */
export function createWorldIdIdKitProofResolver(
  options: WorldIdIdKitResolverOptions = {},
): ProviderProofResolver {
  return createWorldIdProofResolver(async ({ providerRequest }) => {
    const proofRequest = await createWorldIdProofRequest(providerRequest);
    await options.onConnectorUri?.({
      connectorUri: proofRequest.connectorUri,
      providerRequest,
    });
    return proofRequest.collect(options.wait);
  });
}
