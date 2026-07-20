/**
 * Authenticated verifier metadata document (P2-02).
 * Resource servers trust configured publishers/keys — never a key presented beside a token.
 */

import {
  createPublicKey,
  createPrivateKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import {
  canonicalJson,
  parseCanonicalJsonBytes,
  sha256,
} from "../canonical.js";
import { decodeStrictBase64Url, encodeStrictBase64Url } from "../encoding.js";
import { assertTrustedHttpsUrl } from "../transport.js";
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

export interface VerifierMetadataTrustPolicy {
  /** Exact configured issuer origin. Required by production consumers. */
  readonly expectedIssuer?: string;
  /** Extra endpoint origins are opt-in; otherwise every endpoint is issuer-owned. */
  readonly allowedEndpointOrigins?: readonly string[];
  readonly allowHttpLocalhost?: boolean;
}

function originOnly(url: URL, label: string): URL {
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label} must be an origin, without path, query, or hash`);
  }
  return url;
}

function assertMetadataDocument(
  document: VerifierMetadataDocument,
  now: Date,
  policy: VerifierMetadataTrustPolicy,
): void {
  if (document.x424Version !== X424_VERSION) {
    throw new Error("Unsupported metadata protocol version");
  }
  if (!document.metadataId || !document.issuer) {
    throw new Error("Metadata missing required identity fields");
  }
  const issuer = originOnly(
    assertTrustedHttpsUrl(document.issuer, policy.allowHttpLocalhost === true),
    "Metadata issuer",
  );
  if (policy.expectedIssuer) {
    const expected = originOnly(
      assertTrustedHttpsUrl(
        policy.expectedIssuer,
        policy.allowHttpLocalhost === true,
      ),
      "Expected metadata issuer",
    );
    if (issuer.origin !== expected.origin) {
      throw new Error("Metadata issuer does not match configured issuer");
    }
  }
  const issuedAt = Date.parse(document.issuedAt);
  const expiresAt = Date.parse(document.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
    throw new Error("Metadata timestamps are invalid");
  }
  if (issuedAt >= expiresAt) {
    throw new Error("Metadata issuedAt must be before expiresAt");
  }
  if (issuedAt > now.getTime()) {
    throw new Error("Metadata issuedAt is in the future");
  }
  if (expiresAt <= now.getTime()) {
    throw new Error("Verifier metadata expired or invalid");
  }
  const allowedOrigins = new Set(
    (policy.allowedEndpointOrigins ?? []).map(
      (value) =>
        originOnly(
          assertTrustedHttpsUrl(value, policy.allowHttpLocalhost === true),
          "Allowed endpoint origin",
        ).origin,
    ),
  );
  for (const endpoint of Object.values(document.endpoints)) {
    const endpointUrl = assertTrustedHttpsUrl(
      endpoint,
      policy.allowHttpLocalhost === true,
    );
    if (
      endpointUrl.origin !== issuer.origin &&
      !allowedOrigins.has(endpointUrl.origin)
    ) {
      throw new Error(
        "Metadata endpoint origin is not trusted for this issuer",
      );
    }
  }
  if (!Array.isArray(document.keys) || document.keys.length === 0) {
    throw new Error("Metadata must include signing keys");
  }
  const kids = new Set<string>();
  for (const key of document.keys) {
    if (key.alg !== "EdDSA")
      throw new Error("Unsupported metadata key algorithm");
    if (!key.kid || kids.has(key.kid)) {
      throw new Error("Duplicate or missing metadata kid");
    }
    kids.add(key.kid);
    if (!["active", "retired", "revoked"].includes(key.status)) {
      throw new Error("Invalid metadata key status");
    }
    const nbf = Date.parse(key.notBefore);
    const exp = Date.parse(key.notAfter);
    if (!Number.isFinite(nbf) || !Number.isFinite(exp) || nbf >= exp) {
      throw new Error("Invalid metadata key validity interval");
    }
    if (key.publicKeyJwk?.kty !== "OKP" || key.publicKeyJwk.crv !== "Ed25519") {
      throw new Error("Metadata key JWK must be OKP Ed25519");
    }
    if (
      typeof key.publicKeyJwk.x !== "string" ||
      decodeStrictBase64Url(key.publicKeyJwk.x, "metadata JWK x").byteLength !==
        32
    ) {
      throw new Error("Metadata key JWK x must be an Ed25519 public key");
    }
  }
}

export function signVerifierMetadata(
  document: VerifierMetadataDocument,
  signer: { readonly keyId: string; readonly privateKey: KeyObject | string },
): string {
  assertMetadataDocument(document, new Date(document.issuedAt), {
    allowHttpLocalhost: true,
  });
  const header = {
    alg: "EdDSA" as const,
    typ: X424_METADATA_TYP,
    kid: signer.keyId,
  };
  const protectedHeader = encodeStrictBase64Url(
    Buffer.from(canonicalJson(header), "utf8"),
  );
  const payload = encodeStrictBase64Url(
    Buffer.from(canonicalJson(document), "utf8"),
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

export function verifyVerifierMetadataToken(
  token: string,
  trustedKeys: ReadonlyMap<string, KeyObject | string>,
  now = new Date(),
  options?: VerifierMetadataTrustPolicy,
): VerifierMetadataDocument {
  if (!token || token.length > 65_536) {
    throw new Error("Malformed verifier metadata token");
  }
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed verifier metadata token");
  const [protectedHeader, payload, signature] = parts as [
    string,
    string,
    string,
  ];
  if (!protectedHeader || !payload || !signature) {
    throw new Error("Malformed verifier metadata token");
  }
  const header = parseCanonicalJsonBytes(
    decodeStrictBase64Url(protectedHeader, "metadata header"),
    "metadata header",
  ) as { alg?: string; typ?: string; kid?: string };
  if (
    header.alg !== "EdDSA" ||
    header.typ !== X424_METADATA_TYP ||
    !header.kid
  ) {
    throw new Error("Unsupported verifier metadata header");
  }
  for (const key of Object.keys(header)) {
    if (key !== "alg" && key !== "typ" && key !== "kid") {
      throw new Error("Unsupported verifier metadata header field");
    }
  }
  const key = trustedKeys.get(header.kid);
  if (!key) throw new Error("Unknown verifier metadata kid");
  const publicKey = typeof key === "string" ? createPublicKey(key) : key;
  const signingInput = `${protectedHeader}.${payload}`;
  const signatureBytes = decodeStrictBase64Url(signature, "metadata signature");
  if (signatureBytes.byteLength !== 64) {
    throw new Error("Invalid verifier metadata signature length");
  }
  if (
    !verify(
      null,
      Buffer.from(signingInput),
      publicKey,
      Buffer.from(signatureBytes),
    )
  ) {
    throw new Error("Invalid verifier metadata signature");
  }
  const document = parseCanonicalJsonBytes(
    decodeStrictBase64Url(payload, "metadata payload"),
    "metadata payload",
  ) as VerifierMetadataDocument;
  assertMetadataDocument(document, now, options ?? {});
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
