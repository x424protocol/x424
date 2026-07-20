import { createHash } from "node:crypto";

export const X424_CANON_PROFILE = "x424-canon-0.1" as const;

type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

function normalize(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite JSON number");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const output: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) continue;
      output[key] = normalize(child);
    }
    return output;
  }
  throw new Error(`Value is not canonical JSON: ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("base64url")}`;
}

export type RequestBodyDigestInput =
  | { readonly kind: "absent" }
  | { readonly kind: "empty" }
  | { readonly kind: "json"; readonly value: unknown }
  | { readonly kind: "opaque"; readonly bytes: Uint8Array }
  | { readonly kind: "precomputed"; readonly bodyDigest: string }
  | { readonly kind: "stream" };

/**
 * Compute bodyDigest per ADR-0002. Streams without a precomputed digest fail
 * closed. Legacy `requestDigest({ body })` treats plain objects/arrays as JSON.
 */
export function bodyDigestFromInput(
  input: RequestBodyDigestInput,
): string | null {
  switch (input.kind) {
    case "absent":
    case "empty":
      return null;
    case "json":
      return sha256(canonicalJson(input.value));
    case "opaque":
      return sha256(input.bytes);
    case "precomputed":
      if (!input.bodyDigest.startsWith("sha256:")) {
        throw new Error("Precomputed bodyDigest must use sha256: prefix");
      }
      return input.bodyDigest;
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

function legacyBodyToDigestInput(body: unknown): RequestBodyDigestInput {
  if (body === undefined) return { kind: "absent" };
  if (body === null) return { kind: "json", value: null };
  if (typeof body === "string") {
    if (body.length === 0) return { kind: "empty" };
    return { kind: "opaque", bytes: Buffer.from(body, "utf8") };
  }
  if (body instanceof Uint8Array) {
    if (body.byteLength === 0) return { kind: "empty" };
    return { kind: "opaque", bytes: body };
  }
  if (typeof body === "object") {
    return { kind: "json", value: body };
  }
  throw new Error(`Unsupported request body type: ${typeof body}`);
}

export function requestDigest(input: {
  readonly method: string;
  readonly uri: string;
  readonly body?: unknown;
  readonly bodyInput?: RequestBodyDigestInput;
}): string {
  const bodyDigest =
    input.bodyInput !== undefined
      ? bodyDigestFromInput(input.bodyInput)
      : bodyDigestFromInput(legacyBodyToDigestInput(input.body));
  return sha256(
    canonicalJson({
      method: input.method.toUpperCase(),
      uri: input.uri,
      bodyDigest,
    }),
  );
}
