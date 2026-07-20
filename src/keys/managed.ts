/**
 * KMS/HSM-compatible signing and pairwise-secret interfaces (P2-03).
 * Production deployments must not export private result-signing material.
 */

import {
  createHmac,
  createPrivateKey,
  sign,
  type KeyObject,
} from "node:crypto";

export type KeyLifecycleStatus = "pending" | "active" | "retired" | "revoked";

export interface ManagedKeyDescriptor {
  readonly kid: string;
  readonly role: "result-signing" | "pairwise-hmac" | "metadata-signing";
  readonly status: KeyLifecycleStatus;
  readonly notBefore: string;
  readonly notAfter: string;
}

export interface ExternalResultSigner {
  readonly keyId: string;
  readonly status: KeyLifecycleStatus;
  readonly notBefore: string;
  readonly notAfter: string;
  /** Sign the exact JWS signing input bytes without exporting the private key. */
  sign(signingInput: Uint8Array): Promise<Uint8Array> | Uint8Array;
}

export interface PairwiseSecretVersion {
  readonly version: string;
  readonly status: KeyLifecycleStatus;
  readonly notBefore: string;
  readonly notAfter: string;
  readonly secret: Uint8Array;
}

export function assertKeyUsable(
  key: Pick<ManagedKeyDescriptor, "status" | "notBefore" | "notAfter">,
  now = new Date(),
): void {
  if (key.status === "revoked") throw new Error("Key revoked");
  if (key.status === "pending") throw new Error("Key not yet active");
  const nbf = Date.parse(key.notBefore);
  const exp = Date.parse(key.notAfter);
  if (
    !Number.isFinite(nbf) ||
    !Number.isFinite(exp) ||
    now.getTime() < nbf ||
    now.getTime() >= exp
  ) {
    throw new Error("Key outside validity interval");
  }
}

/** Local development signer that wraps a KeyObject. Not for production custody. */
export function createLocalExternalResultSigner(input: {
  readonly keyId: string;
  readonly privateKey: KeyObject | string;
  readonly notBefore: string;
  readonly notAfter: string;
  readonly status?: KeyLifecycleStatus;
}): ExternalResultSigner {
  const privateKey =
    typeof input.privateKey === "string"
      ? createPrivateKey(input.privateKey)
      : input.privateKey;
  return {
    keyId: input.keyId,
    status: input.status ?? "active",
    notBefore: input.notBefore,
    notAfter: input.notAfter,
    sign(signingInput) {
      assertKeyUsable(this);
      return sign(null, Buffer.from(signingInput), privateKey);
    },
  };
}

export function derivePairwiseHumanId(input: {
  readonly secret: PairwiseSecretVersion;
  readonly audience: string;
  readonly providerId: string;
  readonly methodId: string;
  readonly providerSubject: string;
  readonly now?: Date;
}): string {
  assertKeyUsable(input.secret, input.now);
  const mac = createHmac("sha256", input.secret.secret)
    .update(
      [
        input.secret.version,
        input.audience,
        input.providerId,
        input.methodId,
        input.providerSubject,
      ].join("\n"),
    )
    .digest("base64url");
  return `x424_human_${input.secret.version}_${mac}`;
}

/**
 * Pairwise secret rotation is an identity migration. Overlap allows verifying
 * old IDs while issuing under the new version; cutover is adopter-owned.
 */
export function selectIssuingPairwiseSecret(
  versions: readonly PairwiseSecretVersion[],
  now = new Date(),
): PairwiseSecretVersion {
  const active = versions.filter((version) => {
    try {
      assertKeyUsable(version, now);
      return version.status === "active";
    } catch {
      return false;
    }
  });
  if (active.length !== 1) {
    throw new Error("Exactly one active pairwise secret version is required");
  }
  return active[0]!;
}
