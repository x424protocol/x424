import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { methodKey } from "./catalog.js";
import { assertHumanProviderAdapterConformance } from "./provider-sdk.js";
import { signHumanResult, type ResultSigner } from "./result-token.js";
import type {
  HumanMethodDescriptor,
  HumanProofSubmission,
  HumanProviderAdapter,
  HumanRequirement,
  HumanResult,
  NonceStore,
  ProviderVerifiedHuman,
} from "./types.js";
import { X424_VERSION } from "./types.js";
import {
  acceptedMethodForProof,
  assertRequirementCurrent,
} from "./validation.js";

export interface X424ServiceOptions {
  readonly catalog: ReadonlyMap<string, HumanMethodDescriptor>;
  readonly adapters: readonly HumanProviderAdapter[];
  readonly nonceStore: NonceStore;
  readonly pairwiseSecret: Uint8Array;
  readonly resultSigner: ResultSigner;
  readonly maximumResultTtlSeconds?: number;
  readonly now?: () => Date;
}

function assertVerifiedOutput(
  verified: ProviderVerifiedHuman,
  requirement: HumanRequirement,
  proof: HumanProofSubmission,
  descriptor: HumanMethodDescriptor,
  now: Date,
): void {
  if (
    verified.providerId !== proof.providerId ||
    verified.methodId !== proof.methodId ||
    verified.descriptorVersion !== descriptor.version ||
    !descriptor.nativeScopeKinds.includes(verified.uniquenessScope.kind) ||
    !descriptor.verificationModes.includes(verified.verificationMode) ||
    !verified.providerSubject ||
    !verified.proofDigest
  ) {
    throw new Error("Provider adapter returned an incompatible human result");
  }
  const accepted = acceptedMethodForProof(requirement, proof);
  if (
    !accepted.acceptedScopeKinds.includes(verified.uniquenessScope.kind) ||
    (accepted.verificationModes !== undefined &&
      !accepted.verificationModes.includes(verified.verificationMode)) ||
    (accepted.assuranceLevel !== undefined &&
      accepted.assuranceLevel !== verified.assuranceLevel)
  ) {
    throw new Error("Verified proof does not satisfy the accepted method");
  }
  if (
    verified.assuranceLevel !== undefined &&
    !descriptor.assuranceLevels.includes(verified.assuranceLevel)
  ) {
    throw new Error("Provider adapter returned an unknown assurance label");
  }
  const verifiedAt = Date.parse(verified.verifiedAt);
  const providerExpiresAt = verified.expiresAt
    ? Date.parse(verified.expiresAt)
    : undefined;
  if (
    !Number.isFinite(verifiedAt) ||
    verifiedAt > now.getTime() ||
    (providerExpiresAt !== undefined &&
      (!Number.isFinite(providerExpiresAt) ||
        providerExpiresAt <= now.getTime())) ||
    (accepted.maximumProofAgeSeconds !== undefined &&
      now.getTime() - verifiedAt > accepted.maximumProofAgeSeconds * 1_000)
  ) {
    throw new Error("Provider adapter returned an invalid proof time window");
  }
}

export class X424Service {
  readonly #options: X424ServiceOptions;
  readonly #adapters: ReadonlyMap<string, HumanProviderAdapter>;

  constructor(options: X424ServiceOptions) {
    if (options.pairwiseSecret.byteLength < 32) {
      throw new Error("pairwiseSecret must contain at least 32 random bytes");
    }
    const providerIds = new Set<string>();
    const installedMethods = new Set<string>();
    for (const adapter of options.adapters) {
      assertHumanProviderAdapterConformance(adapter);
      if (providerIds.has(adapter.providerId)) {
        throw new Error(`Duplicate provider adapter: ${adapter.providerId}`);
      }
      providerIds.add(adapter.providerId);
      for (const descriptor of adapter.methods()) {
        const key = methodKey(descriptor.providerId, descriptor.methodId);
        const installed = options.catalog.get(key);
        if (!installed || installed.version !== descriptor.version) {
          throw new Error(
            `Adapter method is missing from catalog: ${descriptor.providerId}:${descriptor.methodId}@${descriptor.version}`,
          );
        }
        installedMethods.add(key);
      }
    }
    for (const [key, descriptor] of options.catalog) {
      if (descriptor.status === "enabled" && !installedMethods.has(key)) {
        throw new Error(`Enabled catalog method has no adapter: ${key}`);
      }
    }
    this.#options = options;
    this.#adapters = new Map(
      options.adapters.map((adapter) => [adapter.providerId, adapter]),
    );
  }

  async register(requirement: HumanRequirement): Promise<void> {
    assertRequirementCurrent(requirement, this.#now());
    await this.#options.nonceStore.put(
      requirement.dependencyId,
      requirement.nonce,
      requirement.expiresAt,
    );
  }

  async satisfy(input: {
    readonly requirement: HumanRequirement;
    readonly proof: HumanProofSubmission;
  }): Promise<{ readonly result: HumanResult; readonly token: string }> {
    const { requirement, proof } = input;
    const challengeCheckedAt = this.#now();
    assertRequirementCurrent(requirement, challengeCheckedAt);
    const acceptedMethod = acceptedMethodForProof(requirement, proof);
    const descriptor = this.#options.catalog.get(
      methodKey(proof.providerId, proof.methodId),
    );
    if (!descriptor || descriptor.status !== "enabled") {
      throw new Error("Human method is unknown or disabled");
    }
    if (descriptor.version !== acceptedMethod.descriptorVersion) {
      throw new Error("Human method descriptor version does not match");
    }
    const adapter = this.#adapters.get(proof.providerId);
    if (!adapter)
      throw new Error(`No adapter for provider: ${proof.providerId}`);

    // Consume before calling an external verifier. A retry receives a fresh
    // dependency instead of risking two successful effects for one challenge.
    if (
      !(await this.#options.nonceStore.consume(
        requirement.dependencyId,
        requirement.nonce,
        challengeCheckedAt,
      ))
    ) {
      throw new Error(
        "Human dependency nonce is unknown, expired, or already used",
      );
    }

    const verified = await adapter.verify({
      requirement,
      acceptedMethod,
      proof,
    });
    const issuedAt = this.#now();
    assertRequirementCurrent(requirement, issuedAt);
    assertVerifiedOutput(verified, requirement, proof, descriptor, issuedAt);

    const expiresAtMs = Math.min(
      Date.parse(requirement.expiresAt),
      verified.expiresAt
        ? Date.parse(verified.expiresAt)
        : Number.POSITIVE_INFINITY,
      issuedAt.getTime() +
        (this.#options.maximumResultTtlSeconds ?? 300) * 1_000,
    );
    const pairwiseHumanId = this.#pairwiseId(
      requirement.resource.audience,
      verified.providerId,
      verified.methodId,
      verified.providerSubject,
    );
    const result: HumanResult = {
      x424Version: X424_VERSION,
      resultId: `x424_result_${randomUUID()}`,
      dependencyId: requirement.dependencyId,
      satisfied: true,
      purpose: requirement.purpose,
      audience: requirement.resource.audience,
      requestDigest: requirement.resource.requestDigest,
      binding: requirement.binding,
      providerId: verified.providerId,
      methodId: verified.methodId,
      descriptorVersion: verified.descriptorVersion,
      ...(verified.assuranceLevel
        ? { assuranceLevel: verified.assuranceLevel }
        : {}),
      pairwiseHumanId,
      uniquenessScope: verified.uniquenessScope,
      verificationMode: verified.verificationMode,
      proofDigest: verified.proofDigest,
      claim: descriptor.claim,
      nonClaims: descriptor.nonClaims,
      verifiedAt: verified.verifiedAt,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      ...(verified.stateReferences
        ? { stateReferences: verified.stateReferences }
        : {}),
    };
    return {
      result,
      token: signHumanResult(result, this.#options.resultSigner),
    };
  }

  #now(): Date {
    return this.#options.now?.() ?? new Date();
  }

  #pairwiseId(
    audience: string,
    providerId: string,
    methodId: string,
    providerSubject: string,
  ): string {
    const digest = createHmac("sha256", this.#options.pairwiseSecret)
      .update(
        `${audience}\u0000${providerId}\u0000${methodId}\u0000${providerSubject}`,
      )
      .digest("base64url");
    return `x424_human_${digest}`;
  }
}

export function generatePairwiseSecret(): Uint8Array {
  return randomBytes(32);
}
