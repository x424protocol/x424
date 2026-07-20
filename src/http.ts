import { canonicalJson, parseCanonicalJsonBytes } from "./canonical.js";
import { decodeStrictBase64Url, encodeStrictBase64Url } from "./encoding.js";
import { evaluateHumanResult } from "./policy.js";
import {
  parseHumanRequiredProblem,
  parseHumanRequirement,
  parseHumanResult,
} from "./schemas.js";
import {
  verifyHumanResultToken,
  type ResultVerifier,
  type ResultVerifierKeySet,
} from "./result-token.js";
import {
  X424_HEADER_ABSOLUTE_MAX_BYTES,
  assertHeaderSize,
  assertInlineHeaderEnvelope,
  encodedHeaderByteLength,
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
  const encoded = encodeStrictBase64Url(
    Buffer.from(canonicalJson(value), "utf8"),
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
    Buffer.from(canonicalJson(requirement), "utf8"),
  );
  return selectRequirementTransportMode(encodedHeaderByteLength(encoded));
}

export { X424_HEADER_ABSOLUTE_MAX_BYTES, selectRequirementTransportMode };

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
  readonly requireReplayStore?: boolean;
  readonly now?: Date;
}): Promise<HumanResult> {
  const now = input.now ?? new Date();
  if (input.requireReplayStore && !input.replayStore) {
    throw new Error("ResultReplayStore is required for this profile");
  }
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
  if (input.replayStore) {
    if (
      !(await input.replayStore.consume(result.resultId, result.expiresAt, now))
    ) {
      throw new Error("x424 result token was already consumed");
    }
  }
  return result;
}

export interface HumanRequiredChallenge {
  readonly status: 424;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: X424Problem;
  readonly transport: X424RequirementTransportMode;
}

/**
 * Build a 424 challenge. Requirements above the 8 KiB interop envelope are
 * carried in the problem body only — never as an oversized HUMAN-REQUIRED header.
 */
export function humanRequiredResponse(
  requirement: HumanRequirement,
): HumanRequiredChallenge {
  const encoded = encodeStrictBase64Url(
    Buffer.from(canonicalJson(requirement), "utf8"),
  );
  if (encodedHeaderByteLength(encoded) > X424_HEADER_ABSOLUTE_MAX_BYTES) {
    throw new Error("x424 requirement exceeds absolute transport maximum");
  }
  const transport = selectRequirementTransportMode(
    encodedHeaderByteLength(encoded),
  );
  const baseHeaders: Record<string, string> = {
    "cache-control": "no-store, private",
    "content-type": "application/problem+json",
    vary: HUMAN_PROOF_HEADER,
  };

  if (transport === "header") {
    assertInlineHeaderEnvelope(encoded);
    return {
      status: 424,
      transport: "header",
      headers: {
        ...baseHeaders,
        [HUMAN_REQUIRED_HEADER]: encoded,
      },
      body: {
        type: "https://x424.org/problems/human-required",
        title: "Unique human required",
        status: 424,
        detail: "This action depends on an accepted unique-human proof.",
        dependencyId: requirement.dependencyId,
        x424Transport: "header",
      },
    };
  }

  return {
    status: 424,
    transport: "body",
    headers: baseHeaders,
    body: {
      type: "https://x424.org/problems/human-required",
      title: "Unique human required",
      status: 424,
      detail: "This action depends on an accepted unique-human proof.",
      dependencyId: requirement.dependencyId,
      x424Transport: "body",
      requirement,
    },
  };
}

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
