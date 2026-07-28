import { createHash } from "node:crypto";
import {
  bodyInputFromPlainJsonBody,
  canonicalJson,
  isPlainJsonValue,
  type RequestBodyDigestInput,
} from "./canonical-json.js";
import { assertSha256Digest } from "./encoding.js";

export {
  bodyInputFromPlainJsonBody,
  canonicalJson,
  isPlainJsonValue,
  parseCanonicalJsonBytes,
} from "./canonical-json.js";
export type { JsonValue, RequestBodyDigestInput } from "./canonical-json.js";

export const X424_CANON_PROFILE = "x424-canon-0.1" as const;

export function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("base64url")}`;
}

export function bodyDigestFromInput(
  input: RequestBodyDigestInput,
): string | null {
  switch (input.kind) {
    case "absent":
    case "empty":
      return null;
    case "json": {
      if (!isPlainJsonValue(input.value) || typeof input.value !== "object") {
        throw new Error("json bodyInput requires a plain JSON object or array");
      }
      if (input.value === null) {
        throw new Error("json bodyInput requires a plain JSON object or array");
      }
      return sha256(canonicalJson(input.value));
    }
    case "opaque":
      if (!(input.bytes instanceof Uint8Array)) {
        throw new Error("opaque bodyInput requires Uint8Array bytes");
      }
      if (input.bytes.byteLength === 0) return null;
      return sha256(input.bytes);
    case "precomputed":
      return assertSha256Digest(input.bodyDigest);
    case "stream":
      throw new Error(
        "Streamed bodies require a precomputed bodyDigest (fail closed)",
      );
    default: {
      const _exhaustive: never = input;
      return _exhaustive;
    }
  }
}

export function requestDigest(input: {
  readonly method: string;
  readonly uri: string;
  /** @deprecated Prefer bodyInput. Only plain JSON object/array/Uint8Array. */
  readonly body?: unknown;
  readonly bodyInput?: RequestBodyDigestInput;
}): string {
  const bodyDigest =
    input.bodyInput !== undefined
      ? bodyDigestFromInput(input.bodyInput)
      : bodyDigestFromInput(bodyInputFromPlainJsonBody(input.body));
  return sha256(
    canonicalJson({
      method: input.method.toUpperCase(),
      uri: input.uri,
      bodyDigest,
    }),
  );
}
