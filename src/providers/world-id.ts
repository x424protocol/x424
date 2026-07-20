import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { canonicalJson, sha256 } from "../canonical.js";
import { methodKey } from "../catalog.js";
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

export const WORLD_ID_METHOD_KEY = methodKey(
  WORLD_ID_PROOF_OF_HUMAN_METHOD.providerId,
  WORLD_ID_PROOF_OF_HUMAN_METHOD.methodId,
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

export type WorldIdRemoteVerifier = (nativeProof: unknown) => Promise<unknown>;

export type WorldIdBindingValidator = (input: {
  readonly nativeProof: unknown;
  readonly expectedBinding: HumanBinding;
}) => Promise<boolean>;

export interface WorldIdAdapterOptions {
  readonly rpId: string;
  readonly action: string;
  readonly environment: "production" | "staging";
  /** Optional application check in addition to built-in World signal binding. */
  readonly validateBinding?: WorldIdBindingValidator;
  readonly verifyRemote?: WorldIdRemoteVerifier;
  readonly fetchImplementation?: typeof fetch;
  readonly now?: () => Date;
}

function providerRequestFromRequirement(
  requirement: HumanRequirement,
): WorldIdProviderRequest {
  const value = requirement.providerRequests?.[WORLD_ID_METHOD_KEY];
  if (
    !isRecord(value) ||
    typeof value.appId !== "string" ||
    typeof value.rpId !== "string" ||
    typeof value.action !== "string" ||
    (value.environment !== "production" && value.environment !== "staging") ||
    value.preset !== "proof_of_human" ||
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
  return value as unknown as WorldIdProviderRequest;
}

/** Read the typed IDKit configuration from a trusted x424 requirement. */
export function worldIdProviderRequestFromRequirement(
  requirement: HumanRequirement,
): WorldIdProviderRequest {
  return providerRequestFromRequirement(requirement);
}

export function createWorldIdProofResolver(
  collectProof: (input: {
    readonly requirement: HumanRequirement;
    readonly providerRequest: WorldIdProviderRequest;
  }) => Promise<unknown>,
): ProviderProofResolver {
  return async ({ requirement }) => {
    const accepted = requirement.accepts.some(
      (method) =>
        method.providerId === WORLD_ID_PROOF_OF_HUMAN_METHOD.providerId &&
        method.methodId === WORLD_ID_PROOF_OF_HUMAN_METHOD.methodId &&
        method.descriptorVersion === WORLD_ID_PROOF_OF_HUMAN_METHOD.version,
    );
    if (!accepted) throw new Error("Requirement does not accept World ID");
    const providerRequest = providerRequestFromRequirement(requirement);
    return {
      providerId: WORLD_ID_PROOF_OF_HUMAN_METHOD.providerId,
      methodId: WORLD_ID_PROOF_OF_HUMAN_METHOD.methodId,
      descriptorVersion: WORLD_ID_PROOF_OF_HUMAN_METHOD.version,
      nativeProof: await collectProof({ requirement, providerRequest }),
    };
  };
}

interface NativeProofCandidate {
  readonly identifier: "proof_of_human";
  readonly assuranceLevel: "proof-of-human";
}

function assertNativeProof(
  nativeProof: unknown,
  providerRequest: WorldIdProviderRequest,
  expectedBinding: HumanBinding,
): NativeProofCandidate[] {
  if (
    !isRecord(nativeProof) ||
    nativeProof.protocol_version !== "4.0" ||
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

  const candidates: NativeProofCandidate[] = [];
  for (const response of nativeProof.responses) {
    if (
      !isRecord(response) ||
      response.signal_hash !== providerRequest.signalHash
    ) {
      continue;
    }
    if (response.identifier === "proof_of_human") {
      candidates.push({
        identifier: "proof_of_human",
        assuranceLevel: "proof-of-human",
      });
    }
  }
  if (candidates.length === 0) {
    throw new Error("World proof contains no accepted Proof of Human response");
  }
  return candidates;
}

function acceptedRemoteResult(
  value: unknown,
  candidates: readonly NativeProofCandidate[],
  providerRequest: WorldIdProviderRequest,
): { readonly nullifier: string; readonly candidate: NativeProofCandidate } {
  if (!isRecord(value) || value.success !== true) {
    throw new Error("World did not accept a unique-human proof");
  }
  if (
    (typeof value.action === "string" &&
      value.action !== providerRequest.action) ||
    (typeof value.environment === "string" &&
      value.environment !== providerRequest.environment)
  ) {
    throw new Error("World verification response has the wrong scope");
  }

  if (Array.isArray(value.results)) {
    for (const result of value.results) {
      if (!isRecord(result) || result.success !== true) continue;
      const candidate = candidates.find(
        ({ identifier }) => result.identifier === identifier,
      );
      if (
        candidate &&
        typeof result.nullifier === "string" &&
        result.nullifier
      ) {
        return { nullifier: result.nullifier, candidate };
      }
    }
    throw new Error("World returned no accepted Proof of Human result");
  }

  if (typeof value.nullifier === "string" && value.nullifier) {
    return { nullifier: value.nullifier, candidate: candidates[0]! };
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
    return [WORLD_ID_PROOF_OF_HUMAN_METHOD];
  }

  async verify(
    input: Parameters<HumanProviderAdapter["verify"]>[0],
  ): Promise<ProviderVerifiedHuman> {
    const providerRequest = providerRequestFromRequirement(input.requirement);
    if (
      providerRequest.rpId !== this.#options.rpId ||
      providerRequest.rpContext.rp_id !== this.#options.rpId ||
      providerRequest.action !== this.#options.action ||
      providerRequest.environment !== this.#options.environment ||
      input.acceptedMethod.descriptorVersion !==
        WORLD_ID_PROOF_OF_HUMAN_METHOD.version
    ) {
      throw new Error(
        "Requirement does not match the configured World profile",
      );
    }
    const candidates = assertNativeProof(
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
    const accepted = acceptedRemoteResult(
      response,
      candidates,
      providerRequest,
    );
    const verifiedAt =
      isRecord(response) && typeof response.created_at === "string"
        ? response.created_at
        : (this.#options.now?.() ?? new Date()).toISOString();
    return {
      providerId: this.providerId,
      methodId: WORLD_ID_PROOF_OF_HUMAN_METHOD.methodId,
      descriptorVersion: WORLD_ID_PROOF_OF_HUMAN_METHOD.version,
      assuranceLevel: accepted.candidate.assuranceLevel,
      providerSubject: accepted.nullifier,
      uniquenessScope: {
        kind: "action",
        id: `world:${this.#options.rpId}:${this.#options.action}`,
      },
      verificationMode: "backend",
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
