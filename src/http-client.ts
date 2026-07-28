import { canonicalJson, parseCanonicalJsonBytes } from "./canonical-json.js";
import { decodeStrictBase64Url, encodeStrictBase64Url } from "./encoding.js";
import {
  parseHumanRequiredProblem,
  parseHumanRequirement,
  parseHumanResult,
} from "./schemas.js";
import {
  X424_HEADER_ABSOLUTE_MAX_BYTES,
  assertHeaderSize,
  assertInlineHeaderEnvelope,
  encodedHeaderByteLength,
  selectRequirementTransportMode,
  type X424RequirementTransportMode,
} from "./transport.js";
import type { HumanRequirement, HumanResult } from "./types.js";

export const HUMAN_REQUIRED_HEADER = "human-required";
export const HUMAN_PROOF_HEADER = "human-proof";
export const HUMAN_RESULT_HEADER = "human-result";

export function encodeX424Header(value: unknown): string {
  const encoded = encodeStrictBase64Url(
    new TextEncoder().encode(canonicalJson(value)),
  );
  assertHeaderSize(encoded);
  return encoded;
}

export function decodeX424Header<T>(value: string): T {
  assertHeaderSize(value);
  const bytes = decodeStrictBase64Url(value, "x424 header");
  return parseCanonicalJsonBytes(bytes, "x424 header") as T;
}

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

export function requirementTransportMode(
  requirement: HumanRequirement,
): X424RequirementTransportMode {
  const encoded = encodeStrictBase64Url(
    new TextEncoder().encode(canonicalJson(requirement)),
  );
  return selectRequirementTransportMode(encodedHeaderByteLength(encoded));
}

export { X424_HEADER_ABSOLUTE_MAX_BYTES, selectRequirementTransportMode };

/** Extract HumanRequirement from a 424 challenge (header or body transport). */
export function requirementFromChallenge(input: {
  readonly headers: Headers | { get(name: string): string | null };
  readonly body: unknown;
}): HumanRequirement {
  const headerValue =
    typeof input.headers.get === "function"
      ? (input.headers.get(HUMAN_REQUIRED_HEADER) ??
        input.headers.get("HUMAN-REQUIRED"))
      : null;
  const problem =
    input.body === null || input.body === undefined
      ? undefined
      : parseHumanRequiredProblem(input.body);
  if (headerValue) {
    assertInlineHeaderEnvelope(headerValue);
    const requirement = decodeHumanRequirement(headerValue);
    if (problem) {
      if (
        problem.x424Transport !== "header" ||
        problem.dependencyId !== requirement.dependencyId
      ) {
        throw new Error(
          "424 challenge contains conflicting transport payloads",
        );
      }
    }
    return requirement;
  }
  if (problem?.x424Transport === "body" && problem.requirement) {
    return problem.requirement;
  }
  throw new Error("424 response omitted HUMAN-REQUIRED transport payload");
}
