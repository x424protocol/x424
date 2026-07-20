import { createHash } from "node:crypto";

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

export function requestDigest(input: {
  readonly method: string;
  readonly uri: string;
  readonly body?: unknown;
}): string {
  return sha256(
    canonicalJson({
      method: input.method.toUpperCase(),
      uri: input.uri,
      bodyDigest:
        input.body === undefined ? null : sha256(canonicalJson(input.body)),
    }),
  );
}
