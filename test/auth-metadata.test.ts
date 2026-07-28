import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertProductionBearerCredentials,
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

  it("accepts only explicitly configured own bearer credentials", async () => {
    const auth = createStaticBearerIssuanceAuthenticator({
      configured: principal({ subject: "configured-principal" }),
    });

    await expect(
      auth.authenticate({
        authorizationHeader: "Bearer toString",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(
      auth.authenticate({
        authorizationHeader: "Bearer configured ",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(
      auth.authenticate({
        authorizationHeader: "Bearer configured",
      }),
    ).resolves.toMatchObject({ subject: "configured-principal" });

    const failures = await Promise.all(
      [null, "Basic configured", "Bearer unknown"].map(
        async (authorizationHeader) => {
          try {
            await auth.authenticate({ authorizationHeader });
            throw new Error("authentication unexpectedly succeeded");
          } catch (error) {
            return error as IssuanceAuthorizationError;
          }
        },
      ),
    );
    expect(new Set(failures.map((error) => error.code))).toEqual(
      new Set(["UNAUTHENTICATED"]),
    );
    expect(new Set(failures.map((error) => error.message)).size).toBe(1);
  });

  it("validates and snapshots configured principals", async () => {
    const mutablePurposes = ["publish-record"];
    const configured = principal({ allowedPurposes: mutablePurposes });
    const auth = createStaticBearerIssuanceAuthenticator({
      configured: configured,
    });
    mutablePurposes.push("post-configuration-change");

    const authenticated = await auth.authenticate({
      authorizationHeader: "Bearer configured",
    });
    expect((authenticated as IssuancePrincipal).allowedPurposes).toEqual([
      "publish-record",
    ]);
    expect(Object.isFrozen(authenticated)).toBe(true);

    expect(() =>
      createStaticBearerIssuanceAuthenticator({
        malformed: {
          subject: "issuer-1",
        } as IssuancePrincipal,
      }),
    ).toThrow(IssuanceAuthorizationError);
  });

  it("requires production bearer credentials to encode at least 32 bytes", () => {
    expect(() => assertProductionBearerCredentials({})).toThrow(
      /non-empty record/,
    );
    expect(() =>
      assertProductionBearerCredentials({
        short: principal(),
      }),
    ).toThrow(/at least 32 bytes/);
    expect(() =>
      assertProductionBearerCredentials({
        ["ab".repeat(31)]: principal(),
      }),
    ).toThrow(/at least 32 bytes/);
    expect(() =>
      assertProductionBearerCredentials({
        ["a".repeat(43)]: principal(),
      }),
    ).toThrow(/canonical/);
    expect(() =>
      assertProductionBearerCredentials({
        [`${"a".repeat(42)}A`]: principal(),
      }),
    ).not.toThrow();
    expect(() =>
      assertProductionBearerCredentials({
        ["A".repeat(44)]: principal(),
      }),
    ).not.toThrow();
    expect(() =>
      assertProductionBearerCredentials({
        ["ab".repeat(32)]: principal(),
      }),
    ).not.toThrow();
    expect(() =>
      assertProductionBearerCredentials({
        [Buffer.alloc(32, 251).toString("base64")]: principal(),
      }),
    ).not.toThrow();
    expect(() =>
      assertProductionBearerCredentials({
        [Buffer.alloc(32, 7).toString("base64url")]: principal(),
      }),
    ).not.toThrow();
    expect(() =>
      assertProductionBearerCredentials({
        [`${Buffer.alloc(32, 255).toString("base64url")}=`]: principal(),
      }),
    ).toThrow(/canonical/);
    expect(() =>
      assertProductionBearerCredentials({
        ["!".repeat(64)]: principal(),
      }),
    ).toThrow(/canonical/);
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
