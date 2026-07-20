import { canonicalJson } from "./canonical.js";
import { evaluateHumanResult } from "./policy.js";
import { parseHumanRequirement, parseHumanResult } from "./schemas.js";
import {
  verifyHumanResultToken,
  type ResultVerifier,
  type ResultVerifierKeySet,
} from "./result-token.js";
import {
  X424_HEADER_ABSOLUTE_MAX_BYTES,
  assertHeaderSize,
  selectRequirementTransportMode,
  type X424RequirementTransportMode,
} from "./transport.js";
import type {
  HumanMethodDescriptor,
  HumanRequirement,
  HumanResult,
  ResultReplayStore,
  X424Problem,
} from "./types.js";

export const HUMAN_REQUIRED_HEADER = "human-required";
export const HUMAN_PROOF_HEADER = "human-proof";
export const HUMAN_RESULT_HEADER = "human-result";

export function encodeX424Header(value: unknown): string {
  const encoded = Buffer.from(canonicalJson(value), "utf8").toString(
    "base64url",
  );
  assertHeaderSize(encoded);
  return encoded;
}

export function decodeX424Header<T>(value: string): T {
  assertHeaderSize(value);
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

export function requirementTransportMode(
  requirement: HumanRequirement,
): X424RequirementTransportMode {
  return selectRequirementTransportMode(
    encodeHumanRequirement(requirement).length,
  );
}

export { X424_HEADER_ABSOLUTE_MAX_BYTES, selectRequirementTransportMode };

export function encodeHumanRequirement(requirement: HumanRequirement): string {
  return encodeX424Header(requirement);
}

export function decodeHumanRequirement(value: string): HumanRequirement {
  return parseHumanRequirement(decodeX424Header<unknown>(value));
}

export function encodeHumanResult(result: HumanResult): string {
  return encodeX424Header(result);
}

export function decodeHumanResult(value: string): HumanResult {
  return parseHumanResult(decodeX424Header<unknown>(value));
}

/**
 * Resource-server acceptance path for the HUMAN-PROOF result token. For a
 * mutation, pass a replay store and pair this with application idempotency.
 */
export async function verifyHumanProofHeader(input: {
  readonly humanProof: string;
  readonly requirement: HumanRequirement;
  readonly verifier: ResultVerifier | ResultVerifierKeySet;
  readonly catalog: ReadonlyMap<string, HumanMethodDescriptor>;
  readonly replayStore?: ResultReplayStore;
  readonly now?: Date;
}): Promise<HumanResult> {
  const now = input.now ?? new Date();
  const result = verifyHumanResultToken(input.humanProof, input.verifier);
  const evaluation = evaluateHumanResult({
    requirement: input.requirement,
    result,
    catalog: input.catalog,
    now,
  });
  if (!evaluation.satisfied) {
    throw new Error(
      `x424 result rejected: ${evaluation.failures.map(({ code }) => code).join(",")}`,
    );
  }
  if (
    input.replayStore &&
    !(await input.replayStore.consume(result.resultId, result.expiresAt, now))
  ) {
    throw new Error("x424 result token was already consumed");
  }
  return result;
}

export function humanRequiredResponse(requirement: HumanRequirement): {
  readonly status: 424;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: X424Problem;
} {
  return {
    status: 424,
    headers: {
      [HUMAN_REQUIRED_HEADER]: encodeHumanRequirement(requirement),
      "cache-control": "no-store, private",
      "content-type": "application/problem+json",
      vary: HUMAN_PROOF_HEADER,
    },
    body: {
      type: "https://x424.org/problems/human-required",
      title: "Unique human required",
      status: 424,
      detail: "This action depends on an accepted unique-human proof.",
      dependencyId: requirement.dependencyId,
    },
  };
}
