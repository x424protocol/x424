import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { canonicalJson, sha256 } from "../canonical.js";
import { defineMethodCatalog } from "../catalog.js";
import {
  assertProviderEgressAllowed,
  type CircuitBreaker,
} from "../ops/limits.js";
import type {
  HumanBinding,
  HumanMethodDescriptor,
  HumanMethodRequirement,
  HumanProviderAdapter,
  ProviderVerifiedHuman,
} from "../types.js";
import { isRecord } from "../validation.js";
import {
  WORLD_ID_LEGACY_METHOD_KEY,
  WORLD_ID_LEGACY_ORB_METHOD,
  WORLD_ID_METHOD_KEY,
  WORLD_ID_PROOF_OF_HUMAN_METHOD,
  acceptedWorldMethod,
  createWorldIdMethodRequirements,
  descriptorForNativeProof,
  parseWorldIdProviderRequest,
  providerRequestFromRequirement,
  type WorldIdProviderRequest,
} from "./world-id-shared.js";

export {
  WORLD_ID_LEGACY_METHOD_KEY,
  WORLD_ID_LEGACY_ORB_METHOD,
  WORLD_ID_METHOD_KEY,
  WORLD_ID_PROOF_OF_HUMAN_METHOD,
  createWorldIdLegacyMethodRequirement,
  createWorldIdMethodRequirement,
  createWorldIdMethodRequirements,
  createWorldIdProofResolver,
  worldIdProviderRequestFromRequirement,
} from "./world-id-shared.js";
export type {
  WorldIdProviderRequest,
  WorldIdRpContext,
} from "./world-id-shared.js";

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
  /** Optional for direct adapters; verifier profiles always pin it. */
  readonly appId?: string;
  readonly rpId: string;
  readonly action: string;
  readonly environment: "production" | "staging";
  /** Enables the separately declared world:orb-legacy method. */
  readonly allowLegacyProofs?: boolean;
  /** Optional application check in addition to built-in World signal binding. */
  readonly validateBinding?: WorldIdBindingValidator;
  readonly verifyRemote?: WorldIdRemoteVerifier;
  readonly fetchImplementation?: typeof fetch;
  /** Exact HTTPS origins permitted for World verification egress. */
  readonly allowedEgressOrigins?: readonly string[];
  readonly circuitBreaker?: CircuitBreaker;
  readonly now?: () => Date;
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

  validateProviderRequest(
    input: Parameters<HumanProviderAdapter["validateProviderRequest"]>[0],
  ): void {
    const providerRequest = parseWorldIdProviderRequest(input.providerRequest);
    const acceptsCurrent = acceptedWorldMethod(
      input.requirement,
      WORLD_ID_PROOF_OF_HUMAN_METHOD,
    );
    const acceptsLegacy = acceptedWorldMethod(
      input.requirement,
      WORLD_ID_LEGACY_ORB_METHOD,
    );
    const legacyEnabled = this.#options.allowLegacyProofs === true;
    const createdAt = providerRequest.rpContext.created_at;
    const expiresAt = providerRequest.rpContext.expires_at;
    const ttlSeconds = expiresAt - createdAt;

    if (
      (this.#options.appId !== undefined &&
        providerRequest.appId !== this.#options.appId) ||
      providerRequest.rpId !== this.#options.rpId ||
      providerRequest.rpContext.rp_id !== this.#options.rpId ||
      providerRequest.action !== this.#options.action ||
      providerRequest.environment !== this.#options.environment ||
      providerRequest.signal !== input.requirement.binding.value ||
      providerRequest.signalHash !== hashSignal(input.requirement.binding.value)
    ) {
      throw new Error(
        "World provider request does not match the configured verifier profile",
      );
    }
    if (!acceptsCurrent) {
      throw new Error("A World Proof of Human ceremony requires the v4 method");
    }
    if (
      acceptsLegacy !== providerRequest.allowLegacyProofs ||
      (acceptsLegacy && !legacyEnabled) ||
      (input.acceptedMethod.methodId === WORLD_ID_LEGACY_ORB_METHOD.methodId &&
        !legacyEnabled)
    ) {
      throw new Error(
        "World provider request legacy policy does not match accepted methods",
      );
    }
    if (
      !Number.isSafeInteger(createdAt) ||
      !Number.isSafeInteger(expiresAt) ||
      createdAt >= expiresAt ||
      ttlSeconds < 30 ||
      ttlSeconds > 900
    ) {
      throw new Error("World provider request lifetime is invalid");
    }
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
    // World v4 uses one canonical verification endpoint. The proof payload
    // carries its production/staging environment and World validates it.
    const origin = "https://developer.world.org";
    assertProviderEgressAllowed(
      origin,
      this.#options.allowedEgressOrigins ?? [origin],
    );
    this.#options.circuitBreaker?.assertClosed();
    try {
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
      this.#options.circuitBreaker?.recordSuccess();
      return body;
    } catch (error) {
      this.#options.circuitBreaker?.recordFailure();
      throw error;
    }
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

/** World-first high-level profile used by createX424 and managed issuance. */
export function worldProofOfHuman(
  options: WorldIdVerifierProfileOptions,
): WorldIdVerifierProfile {
  return createWorldIdVerifierProfile(options);
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
