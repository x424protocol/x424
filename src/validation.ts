import { timingSafeEqual } from "node:crypto";
import type {
  HumanBinding,
  HumanMethodRequirement,
  HumanProofSubmission,
  HumanRequirement,
} from "./types.js";
import { X424_VERSION } from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sameBinding(left: HumanBinding, right: HumanBinding): boolean {
  return left.kind === right.kind && sameText(left.value, right.value);
}

export function acceptedMethodForProof(
  requirement: HumanRequirement,
  proof: HumanProofSubmission,
): HumanMethodRequirement {
  if (proof.x424Version !== X424_VERSION) {
    throw new Error(`Unsupported x424 version: ${proof.x424Version}`);
  }
  if (!sameText(proof.dependencyId, requirement.dependencyId)) {
    throw new Error("Human proof is for another dependency");
  }
  if (!sameBinding(proof.binding, requirement.binding)) {
    throw new Error("Human proof caller binding does not match");
  }
  const accepted = requirement.accepts.find(
    (candidate) =>
      candidate.providerId === proof.providerId &&
      candidate.methodId === proof.methodId,
  );
  if (!accepted) {
    throw new Error(
      `Human method is not accepted: ${proof.providerId}:${proof.methodId}`,
    );
  }
  return accepted;
}

export function assertRequirementCurrent(
  requirement: HumanRequirement,
  now = new Date(),
): void {
  const createdAt = Date.parse(requirement.createdAt);
  const expiresAt = Date.parse(requirement.expiresAt);
  if (
    requirement.x424Version !== X424_VERSION ||
    !requirement.dependencyId ||
    !requirement.nonce ||
    requirement.accepts.length === 0 ||
    !Number.isFinite(createdAt) ||
    !Number.isFinite(expiresAt) ||
    createdAt > now.getTime() ||
    expiresAt <= now.getTime() ||
    expiresAt <= createdAt
  ) {
    throw new Error("Human requirement is invalid or expired");
  }
}
