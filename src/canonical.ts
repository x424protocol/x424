import { createHash } from "node:crypto";
import { assertSha256Digest, decodeStrictUtf8 } from "./encoding.js";

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
    if (!isPlainJsonObject(value)) {
      throw new Error(
        "Value is not plain JSON; use opaque bytes or an explicit bodyInput kind",
      );
    }
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

/** True only for plain Object/Array trees of JSON primitives (no Date/Blob/class). */
export function isPlainJsonValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isPlainJsonValue);
  if (typeof value === "object" && value !== null && isPlainJsonObject(value)) {
    return Object.values(value).every(isPlainJsonValue);
  }
  return false;
}

function isPlainJsonObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

/**
 * Parse a wire JSON value only when its UTF-8 source is exactly this profile's
 * canonical representation. This rejects duplicate keys, whitespace, and key
 * ordering ambiguity before a requirement, JWS, or metadata document is used.
 */
export function parseCanonicalJsonBytes(
  bytes: Uint8Array,
  label = "canonical JSON",
): unknown {
  const text = decodeStrictUtf8(bytes, label);
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Malformed ${label}`);
  }
  if (canonicalJson(value) !== text) {
    throw new Error(`Non-canonical ${label}`);
  }
  return value;
}

export function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("base64url")}`;
}

/**
 * Explicit body digest input (ADR-0002). Callers must select a kind; arbitrary
 * objects are never inferred as JSON.
 */
export type RequestBodyDigestInput =
  | { readonly kind: "absent" }
  | { readonly kind: "empty" }
  | { readonly kind: "json"; readonly value: unknown }
  | { readonly kind: "opaque"; readonly bytes: Uint8Array }
  | { readonly kind: "precomputed"; readonly bodyDigest: string }
  | { readonly kind: "stream" };

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

/**
 * Narrow compatibility helper for already-parsed plain JSON bodies only.
 * Rejects Blob, Buffer-like, FormData, Date, and class instances.
 */
export function bodyInputFromPlainJsonBody(
  body: unknown,
): RequestBodyDigestInput {
  if (body === undefined) return { kind: "absent" };
  if (typeof body === "string") {
    if (body.length === 0) return { kind: "empty" };
    throw new Error(
      "String bodies must be supplied as opaque bytes or precomputed digests",
    );
  }
  if (body instanceof Uint8Array) {
    return body.byteLength === 0
      ? { kind: "empty" }
      : { kind: "opaque", bytes: body };
  }
  if (Array.isArray(body) || (typeof body === "object" && body !== null)) {
    if (!isPlainJsonValue(body)) {
      throw new Error(
        "Non-JSON object bodies must use opaque bytes or a precomputed digest",
      );
    }
    if (Array.isArray(body) || isPlainJsonObject(body)) {
      return { kind: "json", value: body };
    }
  }
  throw new Error(`Unsupported request body type: ${typeof body}`);
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
