import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { canonicalJson, parseCanonicalJsonBytes } from "./canonical.js";
import { decodeStrictBase64Url, encodeStrictBase64Url } from "./encoding.js";
import { parseHumanResult } from "./schemas.js";
import type { HumanResult } from "./types.js";

interface TokenHeader {
  readonly alg: "EdDSA";
  readonly typ: "x424-result+jws";
  readonly kid: string;
}

export interface ResultSigner {
  readonly keyId: string;
  readonly privateKey: KeyObject | string;
}

export interface ResultVerifier {
  readonly keyId: string;
  readonly publicKey: KeyObject | string;
}

/** Trusted key set for rotation overlap. Never trust a key supplied with a token. */
export type ResultVerifierKeySet = ReadonlyMap<string, KeyObject | string>;

export interface ExternalResultSignFn {
  readonly keyId: string;
  sign(signingInput: Uint8Array): Promise<Uint8Array> | Uint8Array;
}

export function generateResultKeyPair(keyId = "x424-dev-1"): {
  readonly signer: ResultSigner;
  readonly verifier: ResultVerifier;
} {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    signer: { keyId, privateKey },
    verifier: { keyId, publicKey },
  };
}

export function signHumanResult(
  result: HumanResult,
  signer: ResultSigner,
): string {
  const header: TokenHeader = {
    alg: "EdDSA",
    typ: "x424-result+jws",
    kid: signer.keyId,
  };
  const protectedHeader = encodeStrictBase64Url(
    Buffer.from(canonicalJson(header), "utf8"),
  );
  const payload = encodeStrictBase64Url(
    Buffer.from(canonicalJson(result), "utf8"),
  );
  const signingInput = `${protectedHeader}.${payload}`;
  const privateKey =
    typeof signer.privateKey === "string"
      ? createPrivateKey(signer.privateKey)
      : signer.privateKey;
  return `${signingInput}.${encodeStrictBase64Url(
    sign(null, Buffer.from(signingInput), privateKey),
  )}`;
}

export async function signHumanResultWithExternal(
  result: HumanResult,
  signer: ExternalResultSignFn,
): Promise<string> {
  const header: TokenHeader = {
    alg: "EdDSA",
    typ: "x424-result+jws",
    kid: signer.keyId,
  };
  const protectedHeader = encodeStrictBase64Url(
    Buffer.from(canonicalJson(header), "utf8"),
  );
  const payload = encodeStrictBase64Url(
    Buffer.from(canonicalJson(result), "utf8"),
  );
  const signingInput = `${protectedHeader}.${payload}`;
  const signature = await signer.sign(Buffer.from(signingInput));
  return `${signingInput}.${encodeStrictBase64Url(signature)}`;
}

function parseTokenHeader(protectedHeader: string): TokenHeader {
  const header = parseCanonicalJsonBytes(
    decodeStrictBase64Url(protectedHeader, "JWS header"),
    "JWS header",
  ) as TokenHeader;
  if (
    header.alg !== "EdDSA" ||
    header.typ !== "x424-result+jws" ||
    typeof header.kid !== "string" ||
    !header.kid
  ) {
    throw new Error("Unsupported x424 result token header");
  }
  const keys = Object.keys(header);
  for (const key of keys) {
    if (key !== "alg" && key !== "typ" && key !== "kid") {
      throw new Error("Unsupported x424 result token header field");
    }
  }
  return header;
}

export function verifyHumanResultToken(
  token: string,
  verifier: ResultVerifier | ResultVerifierKeySet,
): HumanResult {
  if (!token || token.length > 65_536) {
    throw new Error("Malformed x424 result token");
  }
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed x424 result token");
  const [protectedHeader, payload, signature] = parts as [
    string,
    string,
    string,
  ];
  if (!protectedHeader || !payload || !signature) {
    throw new Error("Malformed x424 result token");
  }
  const header = parseTokenHeader(protectedHeader);
  let keyMaterial: KeyObject | string;
  if (verifier instanceof Map) {
    const found = verifier.get(header.kid);
    if (!found) throw new Error("Unknown x424 result token kid");
    keyMaterial = found;
  } else {
    const single = verifier as ResultVerifier;
    if (header.kid !== single.keyId) {
      throw new Error("Unsupported x424 result token header");
    }
    keyMaterial = single.publicKey;
  }
  const publicKey =
    typeof keyMaterial === "string"
      ? createPublicKey(keyMaterial)
      : keyMaterial;
  const signingInput = `${protectedHeader}.${payload}`;
  const signatureBytes = decodeStrictBase64Url(signature, "JWS signature");
  if (signatureBytes.byteLength !== 64) {
    throw new Error("Invalid x424 result token signature length");
  }
  if (
    !verify(
      null,
      Buffer.from(signingInput),
      publicKey,
      Buffer.from(signatureBytes),
    )
  ) {
    throw new Error("Invalid x424 result token signature");
  }
  return parseHumanResult(
    parseCanonicalJsonBytes(
      decodeStrictBase64Url(payload, "JWS payload"),
      "JWS payload",
    ),
  );
}
