import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { canonicalJson } from "./canonical.js";
import { parseHumanResult } from "./schemas.js";
import type { HumanResult } from "./types.js";

interface TokenHeader {
  readonly alg: "EdDSA";
  readonly typ: "x424-result+jws";
  readonly kid: string;
}

function b64(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
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
  const protectedHeader = b64(canonicalJson(header));
  const payload = b64(canonicalJson(result));
  const signingInput = `${protectedHeader}.${payload}`;
  const privateKey =
    typeof signer.privateKey === "string"
      ? createPrivateKey(signer.privateKey)
      : signer.privateKey;
  return `${signingInput}.${b64(sign(null, Buffer.from(signingInput), privateKey))}`;
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
  const protectedHeader = b64(canonicalJson(header));
  const payload = b64(canonicalJson(result));
  const signingInput = `${protectedHeader}.${payload}`;
  const signature = await signer.sign(Buffer.from(signingInput));
  return `${signingInput}.${b64(signature)}`;
}

function parseTokenHeader(protectedHeader: string): TokenHeader {
  const header = JSON.parse(
    Buffer.from(protectedHeader, "base64url").toString("utf8"),
  ) as TokenHeader;
  if (
    header.alg !== "EdDSA" ||
    header.typ !== "x424-result+jws" ||
    !header.kid
  ) {
    throw new Error("Unsupported x424 result token header");
  }
  return header;
}

export function verifyHumanResultToken(
  token: string,
  verifier: ResultVerifier | ResultVerifierKeySet,
): HumanResult {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed x424 result token");
  const [protectedHeader, payload, signature] = parts as [
    string,
    string,
    string,
  ];
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
  if (
    !verify(
      null,
      Buffer.from(signingInput),
      publicKey,
      Buffer.from(signature, "base64url"),
    )
  ) {
    throw new Error("Invalid x424 result token signature");
  }
  return parseHumanResult(
    JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
  );
}
