import {
  IDKit,
  proofOfHuman,
  type IDKitResult,
  type WaitOptions,
} from "@worldcoin/idkit-core";
import type { ProviderProofResolver } from "../client.js";
import {
  createWorldIdProofResolver,
  type WorldIdProviderRequest,
} from "./world-id.js";

export interface WorldIdProofRequest {
  readonly connectorUri: string;
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
    collect: async (options) => {
      const completion = await request.pollUntilCompletion(options);
      if (!completion.success) {
        throw new Error(`World ID proof failed (${completion.error})`);
      }
      return completion.result;
    },
  };
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
