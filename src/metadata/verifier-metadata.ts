/**
 * Authenticated verifier metadata document (P2-02).
 * Resource servers trust configured publishers/keys — never a key beside a token.
 */

import {
  createPublicKey,
  createPrivateKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { canonicalJson, sha256 } from "../canonical.js";
import { X424_VERSION } from "../types.js";

export const X424_METADATA_TYP = "x424-verifier-metadata+jws" as const;

export type VerifierKeyStatus = "active" | "retired" | "revoked";

export interface VerifierSigningKeyMetadata {
  readonly kid: string;
  readonly alg: "EdDSA";
  readonly publicKeyJwk: JsonWebKey;
  readonly status: VerifierKeyStatus;
  readonly notBefore: string;
  readonly notAfter: string;
}

export interface VerifierMetadataDocument {
  readonly x424Version: typeof X424_VERSION;
  readonly metadataId: string;
  readonly issuer: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly endpoints: {
    readonly requirements: string;
    readonly verify: string;
    readonly healthz: string;
    readonly metadata: string;
  };
  readonly supportedMethods: readonly {
    readonly providerId: string;
    readonly methodId: string;
    readonly descriptorVersion: string;
  }[];
  readonly protocolVersions: readonly string[];
  readonly keys: readonly VerifierSigningKeyMetadata[];
}

export interface SignedVerifierMetadata {
  readonly token: string;
  readonly document: VerifierMetadataDocument;
}

function b64(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

export function signVerifierMetadata(
  document: VerifierMetadataDocument,
  signer: { readonly keyId: string; readonly privateKey: KeyObject | string },
): string {
  const header = {
    alg: "EdDSA" as const,
    typ: X424_METADATA_TYP,
    kid: signer.keyId,
  };
  const protectedHeader = b64(canonicalJson(header));
  const payload = b64(canonicalJson(document));
  const signingInput = `${protectedHeader}.${payload}`;
  const privateKey =
    typeof signer.privateKey === "string"
      ? createPrivateKey(signer.privateKey)
      : signer.privateKey;
  return `${signingInput}.${b64(sign(null, Buffer.from(signingInput), privateKey))}`;
}

export function verifyVerifierMetadataToken(
  token: string,
  trustedKeys: ReadonlyMap<string, KeyObject | string>,
  now = new Date(),
): VerifierMetadataDocument {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed verifier metadata token");
  const [protectedHeader, payload, signature] = parts as [
    string,
    string,
    string,
  ];
  const header = JSON.parse(
    Buffer.from(protectedHeader, "base64url").toString("utf8"),
  ) as { alg?: string; typ?: string; kid?: string };
  if (
    header.alg !== "EdDSA" ||
    header.typ !== X424_METADATA_TYP ||
    !header.kid
  ) {
    throw new Error("Unsupported verifier metadata header");
  }
  const key = trustedKeys.get(header.kid);
  if (!key) throw new Error("Unknown verifier metadata kid");
  const publicKey = typeof key === "string" ? createPublicKey(key) : key;
  const signingInput = `${protectedHeader}.${payload}`;
  if (
    !verify(
      null,
      Buffer.from(signingInput),
      publicKey,
      Buffer.from(signature, "base64url"),
    )
  ) {
    throw new Error("Invalid verifier metadata signature");
  }
  const document = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as VerifierMetadataDocument;
  if (document.x424Version !== X424_VERSION) {
    throw new Error("Unsupported metadata protocol version");
  }
  const exp = Date.parse(document.expiresAt);
  const nbf = Date.parse(document.issuedAt);
  if (!Number.isFinite(exp) || !Number.isFinite(nbf) || exp <= now.getTime()) {
    throw new Error("Verifier metadata expired or invalid");
  }
  return document;
}

export function selectActiveResultKey(
  metadata: VerifierMetadataDocument,
  kid: string,
  now = new Date(),
): VerifierSigningKeyMetadata {
  const key = metadata.keys.find((entry) => entry.kid === kid);
  if (!key) throw new Error("Unknown result signing kid");
  if (key.status === "revoked") throw new Error("Result signing key revoked");
  const nbf = Date.parse(key.notBefore);
  const exp = Date.parse(key.notAfter);
  if (
    !Number.isFinite(nbf) ||
    !Number.isFinite(exp) ||
    now.getTime() < nbf ||
    now.getTime() >= exp
  ) {
    throw new Error("Result signing key outside validity interval");
  }
  if (key.status !== "active" && key.status !== "retired") {
    throw new Error("Result signing key not acceptable");
  }
  return key;
}

export function metadataCacheKey(document: VerifierMetadataDocument): string {
  return sha256(
    canonicalJson({
      metadataId: document.metadataId,
      issuer: document.issuer,
      expiresAt: document.expiresAt,
    }),
  );
}

/** Candidate discovery path — not yet a permanent IANA/well-known decision. */
export const X424_METADATA_CANDIDATE_PATH =
  "/.well-known/x424-verifier" as const;
