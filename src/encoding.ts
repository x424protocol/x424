/**
 * Strict base64url and SHA-256 digest decoding for x424 wire objects.
 * Rejects permissive Buffer.from(..., "base64url") ignored-character behavior.
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
  const padded = value + "=".repeat(padLen);
  let buf: Buffer;
  try {
    buf = Buffer.from(padded, "base64");
  } catch {
    throw new EncodingError(`Malformed ${label}`);
  }
  // Node may ignore some invalid padding forms; enforce exact round-trip.
  if (buf.toString("base64url") !== value) {
    throw new EncodingError(`Non-canonical ${label}`);
  }
  return new Uint8Array(buf);
}

export function encodeStrictBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
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
