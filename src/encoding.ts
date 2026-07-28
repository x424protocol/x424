/**
 * Strict base64url and SHA-256 digest decoding for x424 wire objects.
 * The implementation uses browser globals instead of Node's permissive Buffer
 * decoder so portable entrypoints never require a Buffer polyfill.
 */

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export class EncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncodingError";
  }
}

/** Decode unpadded base64url; require canonical round-trip. */
export function decodeStrictBase64Url(
  value: string,
  label = "base64url",
): Uint8Array {
  if (!value) throw new EncodingError(`Empty ${label}`);
  if (value.includes("=")) {
    throw new EncodingError(`${label} must not include padding`);
  }
  if (!BASE64URL_RE.test(value)) {
    throw new EncodingError(`Invalid ${label} alphabet`);
  }
  const padLen = (4 - (value.length % 4)) % 4;
  const padded =
    value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat(padLen);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new EncodingError(`Malformed ${label}`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  // Enforce exact canonical round-trip, including rejected trailing bits.
  if (encodeStrictBase64Url(bytes) !== value) {
    throw new EncodingError(`Non-canonical ${label}`);
  }
  return bytes;
}

export function encodeStrictBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

/** Validate `sha256:` + canonical base64url of exactly 32 bytes. */
export function assertSha256Digest(digest: string): string {
  if (!digest.startsWith("sha256:")) {
    throw new EncodingError("Digest must use sha256: prefix");
  }
  const payload = digest.slice("sha256:".length);
  const bytes = decodeStrictBase64Url(payload, "sha256 digest");
  if (bytes.byteLength !== 32) {
    throw new EncodingError("SHA-256 digest must decode to 32 bytes");
  }
  return digest;
}

export function decodeStrictUtf8(bytes: Uint8Array, label = "UTF-8"): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new EncodingError(`Malformed ${label}`);
  }
}

export function decodeStrictUtf8Json(bytes: Uint8Array): unknown {
  const text = decodeStrictUtf8(bytes, "UTF-8 JSON");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new EncodingError("Malformed JSON");
  }
}
