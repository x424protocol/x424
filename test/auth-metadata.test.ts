import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  authorizeIssuance,
  createStaticBearerIssuanceAuthenticator,
  IssuanceAuthorizationError,
  selectActiveResultKey,
  signVerifierMetadata,
  verifyVerifierMetadataToken,
  type VerifierMetadataDocument,
} from "../src/core.js";

describe("issuance authorization", () => {
  it("requires bearer auth and independent grants", async () => {
    const auth = createStaticBearerIssuanceAuthenticator({
      token: {
        subject: "issuer-1",
        allowedPurposes: ["publish-record"],
        allowedAudiences: ["https://api.example.test"],
        allowedResourceUriPrefixes: ["https://api.example.test/"],
        allowedMethods: ["world:proof-of-human"],
      },
    });
    await expect(
      auth.authenticate({ authorizationHeader: null }),
    ).rejects.toBeInstanceOf(IssuanceAuthorizationError);

    const principal = await auth.authenticate({
      authorizationHeader: "Bearer token",
    });
    expect(() =>
      authorizeIssuance(principal, {
        purpose: "publish-record",
        method: "POST",
        uri: "https://api.example.test/records",
        audience: "https://api.example.test",
        accepts: [{ providerId: "world", methodId: "proof-of-human" }],
      }),
    ).not.toThrow();
    expect(() =>
      authorizeIssuance(principal, {
        purpose: "publish-record",
        method: "POST",
        uri: "https://api.example.test/records",
        audience: "https://api.example.test",
        accepts: [{ providerId: "world", methodId: "orb-legacy" }],
      }),
    ).toThrow(/not authorized for an accepted method/);
  });
});

describe("verifier metadata", () => {
  it("signs and verifies metadata; rejects revoked keys", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const document: VerifierMetadataDocument = {
      x424Version: "0.1",
      metadataId: "meta-1",
      issuer: "https://verifier.example.test",
      issuedAt: "2026-07-19T12:00:00.000Z",
      expiresAt: "2026-07-20T12:00:00.000Z",
      endpoints: {
        requirements: "https://verifier.example.test/v1/requirements",
        verify: "https://verifier.example.test/v1/requirements/{id}/verify",
        healthz: "https://verifier.example.test/healthz",
        metadata: "https://verifier.example.test/.well-known/x424-verifier",
      },
      supportedMethods: [
        {
          providerId: "world",
          methodId: "proof-of-human",
          descriptorVersion: "1",
        },
      ],
      protocolVersions: ["0.1"],
      keys: [
        {
          kid: "k1",
          alg: "EdDSA",
          publicKeyJwk: publicKey.export({ format: "jwk" }) as JsonWebKey,
          status: "active",
          notBefore: "2026-07-19T00:00:00.000Z",
          notAfter: "2026-08-19T00:00:00.000Z",
        },
        {
          kid: "k-revoked",
          alg: "EdDSA",
          publicKeyJwk: publicKey.export({ format: "jwk" }) as JsonWebKey,
          status: "revoked",
          notBefore: "2026-07-01T00:00:00.000Z",
          notAfter: "2026-08-01T00:00:00.000Z",
        },
      ],
    };
    const token = signVerifierMetadata(document, {
      keyId: "meta-signer",
      privateKey,
    });
    const trusted = new Map([["meta-signer", publicKey]]);
    const verified = verifyVerifierMetadataToken(
      token,
      trusted,
      new Date("2026-07-19T12:30:00.000Z"),
    );
    expect(verified.metadataId).toBe("meta-1");
    expect(
      selectActiveResultKey(
        verified,
        "k1",
        new Date("2026-07-19T12:30:00.000Z"),
      ).kid,
    ).toBe("k1");
    expect(() =>
      selectActiveResultKey(
        verified,
        "k-revoked",
        new Date("2026-07-19T12:30:00.000Z"),
      ),
    ).toThrow(/revoked/);
  });
});
