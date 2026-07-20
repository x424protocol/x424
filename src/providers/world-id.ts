import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { canonicalJson, sha256 } from "../canonical.js";
import { defineMethodCatalog, methodKey } from "../catalog.js";
import type { ProviderProofResolver } from "../client.js";
import { defineHumanMethodDescriptor } from "../provider-sdk.js";
import type {
  HumanBinding,
  HumanMethodDescriptor,
  HumanMethodRequirement,
  HumanProviderAdapter,
  HumanRequirement,
  ProviderVerifiedHuman,
} from "../types.js";
import { isRecord } from "../validation.js";

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

export interface CreateWorldIdProviderRequestOptions {
  readonly appId: string;
  readonly rpId: string;
  readonly action: string;
  readonly environment: "production" | "staging";
  readonly signingKeyHex: string;
  readonly binding: HumanBinding;
  /** Defaults to false. Legacy is always an explicit accepted x424 method. */
  readonly allowLegacyProofs?: boolean;
  readonly ttlSeconds?: number;
}

/**
 * Create signed World ID request material without exposing the RP signing key
 * to the client. The x424 caller binding becomes the World signal.
 */
export function createWorldIdProviderRequest(
  options: CreateWorldIdProviderRequestOptions,
): WorldIdProviderRequest {
  if (!options.appId.startsWith("app_")) {
    throw new Error("World provider request requires an app_ ID");
  }
  if (!options.rpId.startsWith("rp_")) {
    throw new Error("World provider request requires an rp_ ID");
  }
  if (!options.action || !options.binding.value) {
    throw new Error("World provider request requires an action and binding");
  }
  const ttlSeconds = options.ttlSeconds ?? 300;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 900) {
    throw new Error("World RP request TTL must be between 30 and 900 seconds");
  }
  const signature = signRequest({
    signingKeyHex: options.signingKeyHex,
    action: options.action,
    ttl: ttlSeconds,
  });
  return Object.freeze({
    appId: options.appId,
    rpId: options.rpId,
    action: options.action,
    environment: options.environment,
    preset: "proof_of_human",
    allowLegacyProofs: options.allowLegacyProofs ?? false,
    signal: options.binding.value,
    signalHash: hashSignal(options.binding.value),
    rpContext: Object.freeze({
      rp_id: options.rpId,
      nonce: signature.nonce,
      created_at: signature.createdAt,
      expires_at: signature.expiresAt,
      signature: signature.sig,
    }),
  });
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

/** Build opaque request material under every exact method it may produce. */
export function createWorldIdProviderRequests(
  options: CreateWorldIdProviderRequestOptions,
): Readonly<Record<string, WorldIdProviderRequest>> {
  const providerRequest = createWorldIdProviderRequest(options);
  return Object.freeze({
    [WORLD_ID_METHOD_KEY]: providerRequest,
    ...(providerRequest.allowLegacyProofs
      ? { [WORLD_ID_LEGACY_METHOD_KEY]: providerRequest }
      : {}),
  });
}

export type WorldIdRemoteVerifier = (nativeProof: unknown) => Promise<unknown>;

export type WorldIdBindingValidator = (input: {
  readonly nativeProof: unknown;
  readonly expectedBinding: HumanBinding;
}) => Promise<boolean>;

export interface WorldIdAdapterOptions {
  readonly rpId: string;
  readonly action: string;
  readonly environment: "production" | "staging";
  /** Enables the separately declared world:orb-legacy method. */
  readonly allowLegacyProofs?: boolean;
  /** Optional application check in addition to built-in World signal binding. */
  readonly validateBinding?: WorldIdBindingValidator;
  readonly verifyRemote?: WorldIdRemoteVerifier;
  readonly fetchImplementation?: typeof fetch;
  readonly now?: () => Date;
}

function parseWorldIdProviderRequest(value: unknown): WorldIdProviderRequest {
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

function providerRequestFromRequirement(
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

function acceptedWorldMethod(
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

function descriptorForNativeProof(nativeProof: unknown): HumanMethodDescriptor {
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

interface NativeProofCandidate {
  readonly descriptor: HumanMethodDescriptor;
  readonly identifier: "proof_of_human" | "orb";
  readonly assuranceLevel: "proof-of-human" | "orb-legacy";
  readonly nativeNullifier: string;
}

function assertNativeProof(
  nativeProof: unknown,
  providerRequest: WorldIdProviderRequest,
  expectedBinding: HumanBinding,
): NativeProofCandidate {
  if (
    !isRecord(nativeProof) ||
    nativeProof.action !== providerRequest.action ||
    nativeProof.environment !== providerRequest.environment ||
    nativeProof.nonce !== providerRequest.rpContext.nonce ||
    !Array.isArray(nativeProof.responses)
  ) {
    throw new Error("World proof does not match the signed provider request");
  }
  if (
    providerRequest.signal !== expectedBinding.value ||
    providerRequest.signalHash !== hashSignal(expectedBinding.value)
  ) {
    throw new Error("World provider request is not bound to the x424 caller");
  }

  if (nativeProof.protocol_version === "4.0") {
    const response = nativeProof.responses.find(
      (candidate) =>
        isRecord(candidate) && candidate.identifier === "proof_of_human",
    );
    if (
      !isRecord(response) ||
      response.signal_hash !== providerRequest.signalHash ||
      !Array.isArray(response.proof) ||
      response.proof.length === 0 ||
      typeof response.nullifier !== "string" ||
      !response.nullifier ||
      response.issuer_schema_id !== 1
    ) {
      throw new Error("World proof contains no valid Proof of Human response");
    }
    return {
      descriptor: WORLD_ID_PROOF_OF_HUMAN_METHOD,
      identifier: "proof_of_human",
      assuranceLevel: "proof-of-human",
      nativeNullifier: response.nullifier,
    };
  }

  if (nativeProof.protocol_version === "3.0") {
    if (!providerRequest.allowLegacyProofs) {
      throw new Error("World provider request did not permit legacy proofs");
    }
    const response = nativeProof.responses.find(
      (candidate) => isRecord(candidate) && candidate.identifier === "orb",
    );
    if (
      !isRecord(response) ||
      response.signal_hash !== providerRequest.signalHash ||
      typeof response.proof !== "string" ||
      !response.proof ||
      typeof response.merkle_root !== "string" ||
      !response.merkle_root ||
      typeof response.nullifier !== "string" ||
      !response.nullifier
    ) {
      throw new Error("World proof contains no valid legacy Orb response");
    }
    return {
      descriptor: WORLD_ID_LEGACY_ORB_METHOD,
      identifier: "orb",
      assuranceLevel: "orb-legacy",
      nativeNullifier: response.nullifier,
    };
  }

  throw new Error("World proof uses an unsupported protocol version");
}

function acceptedRemoteResult(
  value: unknown,
  candidate: NativeProofCandidate,
  providerRequest: WorldIdProviderRequest,
): { readonly nullifier: string; readonly candidate: NativeProofCandidate } {
  if (!isRecord(value) || value.success !== true) {
    throw new Error("World did not accept a unique-human proof");
  }
  if (
    value.action !== providerRequest.action ||
    value.environment !== providerRequest.environment
  ) {
    throw new Error("World verification response has the wrong scope");
  }

  if (Array.isArray(value.results)) {
    for (const result of value.results) {
      if (!isRecord(result) || result.success !== true) continue;
      if (
        result.identifier === candidate.identifier &&
        typeof result.nullifier === "string" &&
        result.nullifier === candidate.nativeNullifier
      ) {
        return { nullifier: result.nullifier, candidate };
      }
    }
    throw new Error("World returned no accepted Proof of Human result");
  }

  if (value.nullifier === candidate.nativeNullifier) {
    return { nullifier: value.nullifier, candidate };
  }
  throw new Error("World returned no accepted Proof of Human result");
}

export class WorldIdAdapter implements HumanProviderAdapter {
  readonly providerId = WORLD_ID_PROOF_OF_HUMAN_METHOD.providerId;
  readonly #options: WorldIdAdapterOptions;

  constructor(options: WorldIdAdapterOptions) {
    if (!options.rpId.startsWith("rp_") || !options.action) {
      throw new Error("World adapter requires an rp_ ID and action");
    }
    this.#options = options;
  }

  methods(): readonly HumanMethodDescriptor[] {
    return [WORLD_ID_PROOF_OF_HUMAN_METHOD, WORLD_ID_LEGACY_ORB_METHOD];
  }

  async verify(
    input: Parameters<HumanProviderAdapter["verify"]>[0],
  ): Promise<ProviderVerifiedHuman> {
    const providerRequest = providerRequestFromRequirement(
      input.requirement,
      input.proof.methodId,
    );
    const descriptor = descriptorForNativeProof(input.proof.nativeProof);
    if (
      providerRequest.rpId !== this.#options.rpId ||
      providerRequest.rpContext.rp_id !== this.#options.rpId ||
      providerRequest.action !== this.#options.action ||
      providerRequest.environment !== this.#options.environment ||
      input.proof.providerId !== descriptor.providerId ||
      input.proof.methodId !== descriptor.methodId ||
      input.acceptedMethod.descriptorVersion !== descriptor.version ||
      (descriptor === WORLD_ID_LEGACY_ORB_METHOD &&
        !this.#options.allowLegacyProofs)
    ) {
      throw new Error(
        "Requirement does not match the configured World profile",
      );
    }
    const candidate = assertNativeProof(
      input.proof.nativeProof,
      providerRequest,
      input.requirement.binding,
    );
    if (
      this.#options.validateBinding &&
      !(await this.#options.validateBinding({
        nativeProof: input.proof.nativeProof,
        expectedBinding: input.requirement.binding,
      }))
    ) {
      throw new Error("World proof failed the application binding policy");
    }

    const response = await (this.#options.verifyRemote
      ? this.#options.verifyRemote(input.proof.nativeProof)
      : this.#verifyWithWorld(input.proof.nativeProof));
    const accepted = acceptedRemoteResult(response, candidate, providerRequest);
    const verifiedAt =
      isRecord(response) && typeof response.created_at === "string"
        ? response.created_at
        : (this.#options.now?.() ?? new Date()).toISOString();
    return {
      providerId: this.providerId,
      methodId: descriptor.methodId,
      descriptorVersion: descriptor.version,
      assuranceLevel: accepted.candidate.assuranceLevel,
      providerSubject: accepted.nullifier,
      uniquenessScope: {
        kind: "action",
        id: `world:${this.#options.rpId}:${this.#options.action}`,
      },
      verificationMode: "backend",
      providerReplayMode: "verifier",
      proofDigest: sha256(canonicalJson(input.proof.nativeProof)),
      verifiedAt,
      stateReferences: [
        `world:rp:${this.#options.rpId}`,
        `world:action:${this.#options.action}`,
        `world:environment:${this.#options.environment}`,
        `world:credential:${accepted.candidate.identifier}`,
      ],
    };
  }

  async #verifyWithWorld(nativeProof: unknown): Promise<unknown> {
    const fetchImplementation = this.#options.fetchImplementation ?? fetch;
    const origin =
      this.#options.environment === "production"
        ? "https://developer.world.org"
        : "https://staging-developer.worldcoin.org";
    const response = await fetchImplementation(
      `${origin}/api/v4/verify/${encodeURIComponent(this.#options.rpId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(nativeProof),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const body: unknown = await response.json();
    if (!response.ok) {
      throw new Error(`World verification failed (${response.status})`);
    }
    return body;
  }
}

export interface WorldIdVerifierProfileOptions extends WorldIdAdapterOptions {
  readonly appId: string;
  readonly signingKeyHex: string;
  readonly maximumProofAgeSeconds?: number;
}

export interface WorldIdVerifierProfile {
  readonly adapter: WorldIdAdapter;
  readonly catalog: ReadonlyMap<string, HumanMethodDescriptor>;
  readonly accepts: readonly HumanMethodRequirement[];
  readonly providerRequests: (input: {
    readonly binding: HumanBinding;
    readonly accepts: readonly HumanMethodRequirement[];
    readonly ttlSeconds: number;
  }) => Promise<Readonly<Record<string, unknown>>>;
}

function exactRequirementAccepted(
  accepts: readonly HumanMethodRequirement[],
  descriptor: HumanMethodDescriptor,
): boolean {
  return accepts.some(
    (method) =>
      method.providerId === descriptor.providerId &&
      method.methodId === descriptor.methodId &&
      method.descriptorVersion === descriptor.version,
  );
}

/**
 * Assemble the reusable World verifier boundary without application fields or
 * business policy. Hosts still supply x424 state, result keys, authentication,
 * authorization, and resource behavior.
 */
export function createWorldIdVerifierProfile(
  options: WorldIdVerifierProfileOptions,
): WorldIdVerifierProfile {
  const adapter = new WorldIdAdapter(options);
  const accepts = createWorldIdMethodRequirements({
    ...(options.allowLegacyProofs === undefined
      ? {}
      : { allowLegacyProofs: options.allowLegacyProofs }),
    ...(options.maximumProofAgeSeconds === undefined
      ? {}
      : { maximumProofAgeSeconds: options.maximumProofAgeSeconds }),
  });
  return Object.freeze({
    adapter,
    catalog: defineMethodCatalog(adapter.methods()),
    accepts,
    providerRequests: async ({
      binding,
      accepts,
      ttlSeconds,
    }: {
      readonly binding: HumanBinding;
      readonly accepts: readonly HumanMethodRequirement[];
      readonly ttlSeconds: number;
    }) => {
      const acceptsCurrent = exactRequirementAccepted(
        accepts,
        WORLD_ID_PROOF_OF_HUMAN_METHOD,
      );
      const acceptsLegacy = exactRequirementAccepted(
        accepts,
        WORLD_ID_LEGACY_ORB_METHOD,
      );
      if (!acceptsCurrent) {
        throw new Error(
          "A World Proof of Human ceremony requires the v4 method",
        );
      }
      if (acceptsLegacy && !options.allowLegacyProofs) {
        throw new Error("World verifier profile has legacy proofs disabled");
      }
      return createWorldIdProviderRequests({
        appId: options.appId,
        rpId: options.rpId,
        action: options.action,
        environment: options.environment,
        signingKeyHex: options.signingKeyHex,
        binding,
        allowLegacyProofs: acceptsLegacy,
        ttlSeconds,
      });
    },
  });
}
