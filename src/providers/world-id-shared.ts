import { canonicalJson } from "../canonical-json.js";
import { methodKey } from "../catalog.js";
import type { ProviderProofResolver } from "../client.js";
import { defineHumanMethodDescriptor } from "../provider-sdk.js";
import type {
  HumanMethodDescriptor,
  HumanMethodRequirement,
  HumanRequirement,
} from "../types.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const WORLD_ID_PROOF_OF_HUMAN_METHOD: HumanMethodDescriptor =
  defineHumanMethodDescriptor({
    providerId: "world",
    methodId: "proof-of-human",
    version: "1",
    status: "enabled",
    claim:
      "World accepted its Proof of Human uniqueness method for the configured relying party and action.",
    nonClaims: [
      "Civil or legal identity",
      "The human's name, age, nationality, or address",
      "Continuous human presence after verification",
      "Ownership of an agent, wallet, account, or transaction",
      "Authorization for any relying-party action beyond the bound dependency",
      "Equivalence to any non-World unique-human method",
    ],
    assuranceLevels: ["proof-of-human"],
    nativeScopeKinds: ["action"],
    verificationModes: ["backend"],
    pairwisePseudonym: true,
    replaySemantics:
      "World uniqueness nullifiers are one-time. The relying party must also atomically consume the x424 dependency nonce.",
    recoverySemantics:
      "World controls credential and authenticator recovery. x424 rotates local pairwise subjects only through an explicit relying-party migration.",
    privacy:
      "The World nullifier remains inside the adapter. x424 exposes only an audience-pairwise HMAC pseudonym and a proof digest.",
  });

/**
 * World ID 3.0 Orb is a separate method, even when IDKit exposes it as the
 * fallback branch of one Proof of Human ceremony. Its nullifier and binding
 * semantics must never be silently promoted to the v4 claim.
 */
export const WORLD_ID_LEGACY_ORB_METHOD: HumanMethodDescriptor =
  defineHumanMethodDescriptor({
    providerId: "world",
    methodId: "orb-legacy",
    version: "1",
    status: "enabled",
    claim:
      "World accepted a legacy World ID 3.0 Orb uniqueness proof for the configured relying party and action.",
    nonClaims: [
      "Civil or legal identity",
      "The human's name, age, nationality, or address",
      "Continuous human presence after verification",
      "Ownership of an agent, wallet, account, or transaction",
      "Authorization for any relying-party action beyond the bound dependency",
      "Equivalence to World ID 4 Proof of Human or any non-World method",
      "Cross-version deduplication against a World ID 4 nullifier",
    ],
    assuranceLevels: ["orb-legacy"],
    nativeScopeKinds: ["action"],
    verificationModes: ["backend"],
    pairwisePseudonym: true,
    replaySemantics:
      "The relying party must atomically retain the legacy World nullifier and consume the x424 dependency nonce. The method does not deduplicate against World ID 4.",
    recoverySemantics:
      "World controls legacy credential recovery. Moving a subject to World ID 4 requires an explicit relying-party cross-version policy.",
    privacy:
      "The legacy World nullifier remains inside the adapter. x424 exposes only an audience-pairwise HMAC pseudonym and a proof digest.",
  });

export const WORLD_ID_METHOD_KEY = methodKey(
  WORLD_ID_PROOF_OF_HUMAN_METHOD.providerId,
  WORLD_ID_PROOF_OF_HUMAN_METHOD.methodId,
);

export const WORLD_ID_LEGACY_METHOD_KEY = methodKey(
  WORLD_ID_LEGACY_ORB_METHOD.providerId,
  WORLD_ID_LEGACY_ORB_METHOD.methodId,
);

export interface WorldIdRpContext {
  readonly rp_id: string;
  readonly nonce: string;
  readonly created_at: number;
  readonly expires_at: number;
  readonly signature: string;
}

/** Trusted, backend-created material consumed by an IDKit client. */
export interface WorldIdProviderRequest {
  readonly appId: string;
  readonly rpId: string;
  readonly action: string;
  readonly environment: "production" | "staging";
  readonly preset: "proof_of_human";
  /** Permit IDKit's v3 Orb branch in the same user ceremony. */
  readonly allowLegacyProofs: boolean;
  readonly signal: string;
  readonly signalHash: string;
  readonly rpContext: WorldIdRpContext;
}

export function createWorldIdMethodRequirement(options?: {
  readonly maximumProofAgeSeconds?: number;
}): HumanMethodRequirement {
  return {
    providerId: WORLD_ID_PROOF_OF_HUMAN_METHOD.providerId,
    methodId: WORLD_ID_PROOF_OF_HUMAN_METHOD.methodId,
    descriptorVersion: WORLD_ID_PROOF_OF_HUMAN_METHOD.version,
    assuranceLevel: "proof-of-human",
    acceptedScopeKinds: ["action"],
    verificationModes: ["backend"],
    ...(options?.maximumProofAgeSeconds === undefined
      ? {}
      : { maximumProofAgeSeconds: options.maximumProofAgeSeconds }),
  };
}

export function createWorldIdLegacyMethodRequirement(options?: {
  readonly maximumProofAgeSeconds?: number;
}): HumanMethodRequirement {
  return {
    providerId: WORLD_ID_LEGACY_ORB_METHOD.providerId,
    methodId: WORLD_ID_LEGACY_ORB_METHOD.methodId,
    descriptorVersion: WORLD_ID_LEGACY_ORB_METHOD.version,
    assuranceLevel: "orb-legacy",
    acceptedScopeKinds: ["action"],
    verificationModes: ["backend"],
    ...(options?.maximumProofAgeSeconds === undefined
      ? {}
      : { maximumProofAgeSeconds: options.maximumProofAgeSeconds }),
  };
}

/**
 * Exact World alternatives for one Proof of Human ceremony. The legacy branch
 * is opt-in and remains visibly distinct in requirements and signed results.
 */
export function createWorldIdMethodRequirements(options?: {
  readonly allowLegacyProofs?: boolean;
  readonly maximumProofAgeSeconds?: number;
}): readonly HumanMethodRequirement[] {
  const requirementOptions =
    options?.maximumProofAgeSeconds === undefined
      ? undefined
      : { maximumProofAgeSeconds: options.maximumProofAgeSeconds };
  return Object.freeze([
    createWorldIdMethodRequirement(requirementOptions),
    ...(options?.allowLegacyProofs
      ? [createWorldIdLegacyMethodRequirement(requirementOptions)]
      : []),
  ]);
}

export function parseWorldIdProviderRequest(
  value: unknown,
): WorldIdProviderRequest {
  if (
    !isRecord(value) ||
    typeof value.appId !== "string" ||
    typeof value.rpId !== "string" ||
    typeof value.action !== "string" ||
    (value.environment !== "production" && value.environment !== "staging") ||
    value.preset !== "proof_of_human" ||
    (value.allowLegacyProofs !== undefined &&
      typeof value.allowLegacyProofs !== "boolean") ||
    typeof value.signal !== "string" ||
    typeof value.signalHash !== "string" ||
    !isRecord(value.rpContext) ||
    typeof value.rpContext.rp_id !== "string" ||
    typeof value.rpContext.nonce !== "string" ||
    typeof value.rpContext.created_at !== "number" ||
    typeof value.rpContext.expires_at !== "number" ||
    typeof value.rpContext.signature !== "string"
  ) {
    throw new Error("Requirement has invalid World provider request material");
  }
  return {
    ...(value as unknown as Omit<WorldIdProviderRequest, "allowLegacyProofs">),
    allowLegacyProofs: value.allowLegacyProofs === true,
  };
}

export function providerRequestFromRequirement(
  requirement: HumanRequirement,
  methodId = WORLD_ID_PROOF_OF_HUMAN_METHOD.methodId,
): WorldIdProviderRequest {
  const key = methodKey(WORLD_ID_PROOF_OF_HUMAN_METHOD.providerId, methodId);
  const providerRequest = parseWorldIdProviderRequest(
    requirement.providerRequests?.[key],
  );
  const otherKey =
    key === WORLD_ID_METHOD_KEY
      ? WORLD_ID_LEGACY_METHOD_KEY
      : WORLD_ID_METHOD_KEY;
  const otherValue = requirement.providerRequests?.[otherKey];
  if (
    otherValue !== undefined &&
    canonicalJson(parseWorldIdProviderRequest(otherValue)) !==
      canonicalJson(providerRequest)
  ) {
    throw new Error("World methods contain inconsistent provider requests");
  }
  return providerRequest;
}

/** Read the typed IDKit configuration from a trusted x424 requirement. */
export function worldIdProviderRequestFromRequirement(
  requirement: HumanRequirement,
  methodId?: string,
): WorldIdProviderRequest {
  return providerRequestFromRequirement(requirement, methodId);
}

export function acceptedWorldMethod(
  requirement: HumanRequirement,
  descriptor: HumanMethodDescriptor,
): boolean {
  return requirement.accepts.some(
    (method) =>
      method.providerId === descriptor.providerId &&
      method.methodId === descriptor.methodId &&
      method.descriptorVersion === descriptor.version,
  );
}

export function descriptorForNativeProof(
  nativeProof: unknown,
): HumanMethodDescriptor {
  if (!isRecord(nativeProof) || !Array.isArray(nativeProof.responses)) {
    throw new Error("World proof has an invalid result shape");
  }
  if (
    nativeProof.protocol_version === "4.0" &&
    nativeProof.responses.some(
      (response) =>
        isRecord(response) && response.identifier === "proof_of_human",
    )
  ) {
    return WORLD_ID_PROOF_OF_HUMAN_METHOD;
  }
  if (
    nativeProof.protocol_version === "3.0" &&
    nativeProof.responses.some(
      (response) => isRecord(response) && response.identifier === "orb",
    )
  ) {
    return WORLD_ID_LEGACY_ORB_METHOD;
  }
  throw new Error("World proof contains no supported unique-human method");
}

export function createWorldIdProofResolver(
  collectProof: (input: {
    readonly requirement: HumanRequirement;
    readonly providerRequest: WorldIdProviderRequest;
  }) => Promise<unknown>,
): ProviderProofResolver {
  return async ({ requirement }) => {
    if (!acceptedWorldMethod(requirement, WORLD_ID_PROOF_OF_HUMAN_METHOD)) {
      throw new Error("A World Proof of Human ceremony requires the v4 method");
    }
    const providerRequest = providerRequestFromRequirement(requirement);
    const nativeProof = await collectProof({ requirement, providerRequest });
    const descriptor = descriptorForNativeProof(nativeProof);
    if (!acceptedWorldMethod(requirement, descriptor)) {
      throw new Error("World ceremony returned an unaccepted human method");
    }
    if (
      descriptor === WORLD_ID_LEGACY_ORB_METHOD &&
      !providerRequest.allowLegacyProofs
    ) {
      throw new Error("World provider request did not permit legacy proofs");
    }
    return {
      providerId: descriptor.providerId,
      methodId: descriptor.methodId,
      descriptorVersion: descriptor.version,
      nativeProof,
    };
  };
}
