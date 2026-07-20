export const X424_VERSION = "0.1" as const;

export type X424Version = typeof X424_VERSION;
export type IsoTimestamp = string;

/** Where an adapter validates the provider-native proof. */
export type VerificationMode = "backend" | "offchain" | "onchain" | "hybrid";

/**
 * A provider's native anti-Sybil namespace. Scopes are deliberately not
 * ordered: an action-scoped nullifier is not silently interchangeable with a
 * relying-party identity or a global registry entry.
 */
export type UniquenessScopeKind =
  "global" | "relying_party" | "action" | "session";

export interface UniquenessScope {
  readonly kind: UniquenessScopeKind;
  readonly id: string;
}

export interface HumanMethodDescriptor {
  readonly providerId: string;
  readonly methodId: string;
  readonly version: string;
  readonly status: "enabled" | "disabled";
  readonly claim: string;
  readonly nonClaims: readonly string[];
  readonly assuranceLevels: readonly string[];
  readonly nativeScopeKinds: readonly UniquenessScopeKind[];
  readonly verificationModes: readonly VerificationMode[];
  readonly pairwisePseudonym: boolean;
  readonly replaySemantics: string;
  readonly recoverySemantics: string;
  readonly privacy: string;
}

export interface HumanMethodRequirement {
  readonly providerId: string;
  readonly methodId: string;
  readonly descriptorVersion: string;
  readonly assuranceLevel?: string;
  readonly acceptedScopeKinds: readonly UniquenessScopeKind[];
  readonly maximumProofAgeSeconds?: number;
  readonly verificationModes?: readonly VerificationMode[];
}

/**
 * The caller identity to which the human result is restricted. For an agent,
 * value should be a public-key fingerprint, not an API key or private key.
 */
export interface HumanBinding {
  readonly kind: "request" | "wallet" | "agent_key" | "session";
  readonly value: string;
}

export interface ProtectedResource {
  readonly method: string;
  readonly uri: string;
  readonly audience: string;
  readonly requestDigest: string;
}

/** Server-to-client payload carried by HUMAN-REQUIRED. */
export interface HumanRequirement {
  readonly x424Version: X424Version;
  readonly dependencyId: string;
  readonly purpose: string;
  readonly resource: ProtectedResource;
  readonly nonce: string;
  readonly binding: HumanBinding;
  readonly createdAt: IsoTimestamp;
  readonly expiresAt: IsoTimestamp;
  /** Explicit alternatives. No provider is accepted unless named here. */
  readonly accepts: readonly HumanMethodRequirement[];
  /** Provider-native request material, keyed by providerId:methodId. */
  readonly providerRequests?: Readonly<Record<string, unknown>>;
}

/** Client-to-verifier provider submission. It is never put in an HTTP header. */
export interface HumanProofSubmission {
  readonly x424Version: X424Version;
  readonly dependencyId: string;
  readonly providerId: string;
  readonly methodId: string;
  readonly binding: HumanBinding;
  /** Kept opaque by the core and passed only to the selected adapter. */
  readonly nativeProof: unknown;
}

export interface ProviderVerifiedHuman {
  readonly providerId: string;
  readonly methodId: string;
  readonly descriptorVersion: string;
  readonly assuranceLevel?: string;
  readonly providerSubject: string;
  readonly uniquenessScope: UniquenessScope;
  readonly verificationMode: VerificationMode;
  /** Request verifier-side subject retention when the provider does not. */
  readonly providerReplayMode?: "provider" | "verifier";
  readonly proofDigest: string;
  readonly verifiedAt: IsoTimestamp;
  readonly expiresAt?: IsoTimestamp;
  readonly stateReferences?: readonly string[];
}

/**
 * Minimal provider-neutral result. It contains a pairwise identifier, never a
 * provider nullifier or globally stable subject.
 */
export interface HumanResult {
  readonly x424Version: X424Version;
  readonly resultId: string;
  readonly dependencyId: string;
  readonly satisfied: true;
  readonly purpose: string;
  readonly audience: string;
  readonly requestDigest: string;
  readonly binding: HumanBinding;
  readonly providerId: string;
  readonly methodId: string;
  readonly descriptorVersion: string;
  readonly assuranceLevel?: string;
  readonly pairwiseHumanId: string;
  readonly uniquenessScope: UniquenessScope;
  readonly verificationMode: VerificationMode;
  readonly proofDigest: string;
  readonly claim: string;
  readonly nonClaims: readonly string[];
  readonly verifiedAt: IsoTimestamp;
  readonly issuedAt: IsoTimestamp;
  readonly expiresAt: IsoTimestamp;
  readonly stateReferences?: readonly string[];
}

export type HumanFailureCode =
  | "ASSURANCE_NOT_ACCEPTED"
  | "AUDIENCE_MISMATCH"
  | "BINDING_MISMATCH"
  | "CLAIM_MISMATCH"
  | "DEPENDENCY_MISMATCH"
  | "DESCRIPTOR_VERSION_MISMATCH"
  | "EXPIRED"
  | "FUTURE_TIMESTAMP"
  | "METHOD_DISABLED"
  | "METHOD_NOT_ACCEPTED"
  | "METHOD_UNKNOWN"
  | "PROOF_STALE"
  | "PURPOSE_MISMATCH"
  | "REQUEST_DIGEST_MISMATCH"
  | "SCOPE_NOT_ACCEPTED"
  | "TIME_WINDOW_INVALID"
  | "VERIFICATION_MODE_NOT_ACCEPTED";

export interface HumanFailure {
  readonly code: HumanFailureCode;
  readonly detail: string;
}

export interface HumanEvaluation {
  readonly satisfied: boolean;
  readonly failures: readonly HumanFailure[];
}

export interface ProviderRequestValidationInput {
  readonly requirement: HumanRequirement;
  readonly acceptedMethod: HumanMethodRequirement;
  /** Opaque material selected by providerId:methodId from providerRequests. */
  readonly providerRequest: unknown;
}

export interface HumanProviderAdapter {
  readonly providerId: string;

  methods(): readonly HumanMethodDescriptor[];

  /**
   * Validate provider-native request material before a dependency nonce is
   * registered. Hosted verifiers use this boundary for adopter-signed material
   * without receiving the adopter's provider signing key.
   */
  validateProviderRequest(
    input: ProviderRequestValidationInput,
  ): Promise<void> | void;

  verify(input: {
    readonly requirement: HumanRequirement;
    readonly acceptedMethod: HumanMethodRequirement;
    readonly proof: HumanProofSubmission;
  }): Promise<ProviderVerifiedHuman>;
}

export interface NonceStore {
  /** Atomically consume once. Returns false for unknown, expired, or used IDs. */
  consume(dependencyId: string, nonce: string, now?: Date): Promise<boolean>;
  put(
    dependencyId: string,
    nonce: string,
    expiresAt: IsoTimestamp,
  ): Promise<void>;
}

export interface ProviderReplayEntry {
  readonly providerId: string;
  readonly methodId: string;
  readonly uniquenessScope: UniquenessScope;
  /** SHA-256 digest; stores never receive the provider's raw subject. */
  readonly subjectDigest: string;
}

export interface ProviderReplayStore {
  /** Atomically retain one provider subject. False means already consumed. */
  consume(entry: ProviderReplayEntry): Promise<boolean>;
}

/**
 * Stores the server-issued requirement that a verifier and resource server
 * later evaluate. Implementations must expire entries at `expiresAt` and must
 * never accept a client-supplied replacement for a stored requirement.
 */
export interface RequirementStore {
  put(requirement: HumanRequirement): Promise<void>;
  get(dependencyId: string, now?: Date): Promise<HumanRequirement | undefined>;
  delete(dependencyId: string): Promise<void>;
}

export interface ResultReplayStore {
  /** Atomically marks a result ID used. False means it was already consumed. */
  consume(
    resultId: string,
    expiresAt: IsoTimestamp,
    now?: Date,
  ): Promise<boolean>;
}

export interface X424Problem {
  readonly type: "https://x424.org/problems/human-required";
  readonly title: "Unique human required";
  readonly status: 424;
  readonly detail: string;
  readonly dependencyId: string;
  /** Transport selected for this challenge (ADR-0001). */
  readonly x424Transport?: "header" | "body";
  /** Present when x424Transport is `body` — never combine with oversized headers. */
  readonly requirement?: HumanRequirement;
}
