import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  authorizeIssuance,
  createStaticBearerIssuanceAuthenticator,
  IssuanceAuthorizationError,
  resourceUriAuthorized,
  selectActiveResultKey,
  signVerifierMetadata,
  verifyVerifierMetadataToken,
  type IssuancePrincipal,
  type VerifierMetadataDocument,
} from "../src/core.js";

function principal(
  overrides: Partial<IssuancePrincipal> = {},
): IssuancePrincipal {
  return {
    subject: "issuer-1",
    allowedPurposes: ["publish-record"],
    allowedAudiences: ["https://api.example.test"],
    allowedHttpMethods: ["POST"],
    allowedMethods: ["world:proof-of-human"],
    allowedResources: [
      { origin: "https://api.example.test", pathPrefix: "/records" },
    ],
    ...overrides,
  };
}

describe("issuance authorization", () => {
  it("denies a principal that only has a subject", () => {
    const bare = {
      subject: "issuer-1",
      allowedPurposes: [],
      allowedAudiences: [],
      allowedHttpMethods: [],
      allowedMethods: [],
      allowedResources: [],
    } satisfies IssuancePrincipal;
    expect(() =>
      authorizeIssuance(
        bare,
        {
          purpose: "publish-record",
          method: "POST",
          uri: "https://api.example.test/records",
          audience: "https://api.example.test",
          accepts: [{ providerId: "world", methodId: "proof-of-human" }],
        },
        "eval-redis-0.2",
      ),
    ).toThrow(IssuanceAuthorizationError);
  });

  it("requires bearer auth and independent grants", async () => {
    const auth = createStaticBearerIssuanceAuthenticator({
      token: principal(),
    });
    await expect(
      auth.authenticate({ authorizationHeader: null }),
    ).rejects.toBeInstanceOf(IssuanceAuthorizationError);

    const granted = await auth.authenticate({
      authorizationHeader: "Bearer token",
    });
    expect(() =>
      authorizeIssuance(
        granted,
        {
          purpose: "publish-record",
          method: "POST",
          uri: "https://api.example.test/records",
          audience: "https://api.example.test",
          accepts: [{ providerId: "world", methodId: "proof-of-human" }],
        },
        "eval-redis-0.2",
      ),
    ).not.toThrow();
    expect(() =>
      authorizeIssuance(
        granted,
        {
          purpose: "publish-record",
          method: "POST",
          uri: "https://api.example.test/records",
          audience: "https://api.example.test",
          accepts: [{ providerId: "world", methodId: "orb-legacy" }],
        },
        "eval-redis-0.2",
      ),
    ).toThrow(/not authorized for an accepted method/);
  });

  it("rejects URI prefix confusion against sibling hosts and paths", () => {
    const grants = [{ origin: "https://example.com", pathPrefix: "/records" }];
    expect(resourceUriAuthorized("https://example.com/records", grants)).toBe(
      true,
    );
    expect(resourceUriAuthorized("https://example.com/records/1", grants)).toBe(
      true,
    );
    expect(
      resourceUriAuthorized("https://example.com.evil/records", grants),
    ).toBe(false);
    expect(
      resourceUriAuthorized("https://example.com/records-evil", grants),
    ).toBe(false);
    expect(
      resourceUriAuthorized(
        "https://example.com/records/%2e%2e%2fsecret",
        grants,
      ),
    ).toBe(false);
    expect(
      resourceUriAuthorized("https://example.com/records/../secret", grants),
    ).toBe(false);
  });
});

describe("verifier metadata", () => {
  it("signs and verifies metadata; rejects revoked keys and future issuedAt", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
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
          publicKeyJwk: jwk,
          status: "active",
          notBefore: "2026-07-19T00:00:00.000Z",
          notAfter: "2026-08-19T00:00:00.000Z",
        },
        {
          kid: "k-revoked",
          alg: "EdDSA",
          publicKeyJwk: jwk,
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
    expect(() =>
      verifyVerifierMetadataToken(
        token,
        trusted,
        new Date("2026-07-19T12:30:00.000Z"),
        { expectedIssuer: "https://other-verifier.example.test" },
      ),
    ).toThrow(/configured issuer/);
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

    const future = {
      ...document,
      issuedAt: "2026-07-19T13:00:00.000Z",
      expiresAt: "2026-07-20T12:00:00.000Z",
    };
    const futureToken = signVerifierMetadata(future, {
      keyId: "meta-signer",
      privateKey,
    });
    expect(() =>
      verifyVerifierMetadataToken(
        futureToken,
        trusted,
        new Date("2026-07-19T12:30:00.000Z"),
      ),
    ).toThrow(/future/);
  });
});
