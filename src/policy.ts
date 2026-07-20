import { methodKey } from "./catalog.js";
import type {
  HumanEvaluation,
  HumanFailure,
  HumanMethodDescriptor,
  HumanMethodRequirement,
  HumanRequirement,
  HumanResult,
} from "./types.js";

function fail(code: HumanFailure["code"], detail: string): HumanFailure {
  return { code, detail };
}

function matchingMethod(
  requirement: HumanRequirement,
  result: HumanResult,
): HumanMethodRequirement | undefined {
  return requirement.accepts.find(
    (candidate) =>
      candidate.providerId === result.providerId &&
      candidate.methodId === result.methodId,
  );
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

/** Deterministically checks an already authenticated x424 result. */
export function evaluateHumanResult(input: {
  readonly requirement: HumanRequirement;
  readonly result: HumanResult;
  readonly catalog: ReadonlyMap<string, HumanMethodDescriptor>;
  readonly now?: Date;
}): HumanEvaluation {
  const { requirement, result, catalog } = input;
  const nowMs = (input.now ?? new Date()).getTime();
  const failures: HumanFailure[] = [];

  if (result.dependencyId !== requirement.dependencyId) {
    failures.push(
      fail("DEPENDENCY_MISMATCH", "Result is for another dependency"),
    );
  }
  if (result.purpose !== requirement.purpose) {
    failures.push(fail("PURPOSE_MISMATCH", "Result purpose does not match"));
  }
  if (result.audience !== requirement.resource.audience) {
    failures.push(fail("AUDIENCE_MISMATCH", "Result audience does not match"));
  }
  if (result.requestDigest !== requirement.resource.requestDigest) {
    failures.push(
      fail("REQUEST_DIGEST_MISMATCH", "Result is bound to another request"),
    );
  }
  if (
    result.binding.kind !== requirement.binding.kind ||
    result.binding.value !== requirement.binding.value
  ) {
    failures.push(fail("BINDING_MISMATCH", "Caller binding does not match"));
  }

  const accepted = matchingMethod(requirement, result);
  if (!accepted) {
    failures.push(
      fail(
        "METHOD_NOT_ACCEPTED",
        `${result.providerId}:${result.methodId} was not explicitly accepted`,
      ),
    );
  }

  const descriptor = catalog.get(methodKey(result.providerId, result.methodId));
  if (!descriptor) {
    failures.push(fail("METHOD_UNKNOWN", "Result names an unknown method"));
  } else if (descriptor.status !== "enabled") {
    failures.push(fail("METHOD_DISABLED", "Result method is disabled"));
  }

  if (
    (accepted && result.descriptorVersion !== accepted.descriptorVersion) ||
    (descriptor && result.descriptorVersion !== descriptor.version)
  ) {
    failures.push(
      fail(
        "DESCRIPTOR_VERSION_MISMATCH",
        "Result uses another method descriptor version",
      ),
    );
  }
  if (
    (accepted &&
      !accepted.acceptedScopeKinds.includes(result.uniquenessScope.kind)) ||
    (descriptor &&
      !descriptor.nativeScopeKinds.includes(result.uniquenessScope.kind))
  ) {
    failures.push(
      fail("SCOPE_NOT_ACCEPTED", "Provider uniqueness scope is not accepted"),
    );
  }
  if (
    (accepted?.verificationModes &&
      !accepted.verificationModes.includes(result.verificationMode)) ||
    (descriptor &&
      !descriptor.verificationModes.includes(result.verificationMode))
  ) {
    failures.push(
      fail(
        "VERIFICATION_MODE_NOT_ACCEPTED",
        "Verification mode is not accepted",
      ),
    );
  }
  if (
    (accepted?.assuranceLevel !== undefined &&
      accepted.assuranceLevel !== result.assuranceLevel) ||
    (descriptor &&
      result.assuranceLevel !== undefined &&
      !descriptor.assuranceLevels.includes(result.assuranceLevel))
  ) {
    failures.push(
      fail(
        "ASSURANCE_NOT_ACCEPTED",
        "Provider-local assurance label is not accepted",
      ),
    );
  }
  if (
    descriptor &&
    (result.claim !== descriptor.claim ||
      !sameStrings(result.nonClaims, descriptor.nonClaims))
  ) {
    failures.push(
      fail("CLAIM_MISMATCH", "Result changed the method claim or non-claims"),
    );
  }

  const requirementCreatedAt = Date.parse(requirement.createdAt);
  const requirementExpiresAt = Date.parse(requirement.expiresAt);
  const verifiedAt = Date.parse(result.verifiedAt);
  const issuedAt = Date.parse(result.issuedAt);
  const expiresAt = Date.parse(result.expiresAt);
  if (
    !Number.isFinite(verifiedAt) ||
    !Number.isFinite(issuedAt) ||
    verifiedAt > nowMs ||
    issuedAt > nowMs
  ) {
    failures.push(fail("FUTURE_TIMESTAMP", "Result timestamps are invalid"));
  }
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
    failures.push(fail("EXPIRED", "Result has expired"));
  }
  if (
    !Number.isFinite(requirementCreatedAt) ||
    !Number.isFinite(requirementExpiresAt) ||
    !Number.isFinite(verifiedAt) ||
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    verifiedAt > issuedAt ||
    issuedAt < requirementCreatedAt ||
    issuedAt >= requirementExpiresAt ||
    expiresAt <= issuedAt ||
    expiresAt > requirementExpiresAt
  ) {
    failures.push(
      fail(
        "TIME_WINDOW_INVALID",
        "Result time window is inconsistent with the dependency",
      ),
    );
  }
  if (
    accepted?.maximumProofAgeSeconds !== undefined &&
    Number.isFinite(verifiedAt) &&
    nowMs - verifiedAt > accepted.maximumProofAgeSeconds * 1_000
  ) {
    failures.push(fail("PROOF_STALE", "Human proof exceeds maximum age"));
  }

  return { satisfied: failures.length === 0, failures };
}
