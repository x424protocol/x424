import { describe, expect, it, vi } from "vitest";
import {
  assertSha256Digest,
  bodyDigestFromInput,
  bodyInputFromPlainJsonBody,
  createHttpHumanDependencyResolver,
  createHumanRequirement,
  decodeStrictBase64Url,
  EncodingError,
  humanRequiredResponse,
  redactForTelemetry,
  assertNoSensitiveLeak,
  requestDigest,
  X424_HEADER_INTEROP_ENVELOPE_BYTES,
  encodeStrictBase64Url,
  canonicalJson,
  decodeX424Header,
  encodeHumanRequirement,
  requirementFromChallenge,
  resolvePublicAbsoluteUri,
} from "../src/core.js";

describe("strict encoding", () => {
  it("rejects ignored-character base64url such as e30$", () => {
    expect(() => decodeStrictBase64Url("e30$")).toThrow(EncodingError);
  });

  it("rejects padded and non-canonical base64url", () => {
    expect(() => decodeStrictBase64Url("e30=")).toThrow(/padding/);
  });

  it("rejects sha256:not-a-digest", () => {
    expect(() => assertSha256Digest("sha256:not-a-digest")).toThrow();
  });
});

describe("body digests", () => {
  it("gives distinct digests for distinct opaque Blobs/bytes", () => {
    const a = bodyDigestFromInput({
      kind: "opaque",
      bytes: new TextEncoder().encode("blob-a"),
    });
    const b = bodyDigestFromInput({
      kind: "opaque",
      bytes: new TextEncoder().encode("blob-b"),
    });
    expect(a).not.toBe(b);
  });

  it("rejects class instances and Date as JSON", () => {
    expect(() => bodyInputFromPlainJsonBody(new Date())).toThrow(/Non-JSON/);
    expect(() => bodyInputFromPlainJsonBody({ when: new Date() })).toThrow(
      /Non-JSON/,
    );
  });

  it("fails closed for streams without precomputed digest", () => {
    expect(() => bodyDigestFromInput({ kind: "stream" })).toThrow(
      /fail closed/,
    );
  });
});

describe("transport envelope", () => {
  it("does not emit oversized HUMAN-REQUIRED headers", () => {
    const hugeProviderRequests: Record<string, unknown> = {};
    // Inflate requirement past 8 KiB encoded.
    hugeProviderRequests["world:proof-of-human"] = {
      pad: "x".repeat(12_000),
    };
    const requirement = createHumanRequirement({
      purpose: "publish-record",
      method: "POST",
      uri: "https://api.example.test/records",
      audience: "https://api.example.test",
      binding: { kind: "session", value: "sha256:session" },
      accepts: [
        {
          providerId: "example",
          methodId: "unique-human",
          descriptorVersion: "1",
          acceptedScopeKinds: ["relying_party"],
        },
      ],
      providerRequests: hugeProviderRequests,
    });
    const challenge = humanRequiredResponse(requirement);
    expect(challenge.transport).toBe("body");
    expect(challenge.headers["human-required"]).toBeUndefined();
    expect(challenge.body.x424Transport).toBe("body");
    expect(challenge.body.requirement?.dependencyId).toBe(
      requirement.dependencyId,
    );
    const tiny = createHumanRequirement({
      purpose: "publish-record",
      method: "POST",
      uri: "https://api.example.test/records",
      audience: "https://api.example.test",
      binding: { kind: "session", value: "sha256:session" },
      accepts: [
        {
          providerId: "example",
          methodId: "unique-human",
          descriptorVersion: "1",
          acceptedScopeKinds: ["relying_party"],
        },
      ],
    });
    const headerChallenge = humanRequiredResponse(tiny);
    expect(headerChallenge.transport).toBe("header");
    const encoded = headerChallenge.headers["human-required"]!;
    expect(Buffer.byteLength(encoded, "utf8")).toBeLessThanOrEqual(
      X424_HEADER_INTEROP_ENVELOPE_BYTES,
    );
  });

  it("boundary: envelope+1 selects body", () => {
    const pad = encodeStrictBase64Url(
      Buffer.from(canonicalJson({ pad: "y".repeat(9000) }), "utf8"),
    );
    expect(Buffer.byteLength(pad, "utf8")).toBeGreaterThan(
      X424_HEADER_INTEROP_ENVELOPE_BYTES,
    );
  });

  it("rejects oversized inline, conflicting, and non-canonical challenges", () => {
    const requirement = createHumanRequirement({
      purpose: "publish-record",
      method: "POST",
      uri: "https://api.example.test/records",
      audience: "https://api.example.test",
      binding: { kind: "session", value: "sha256:session" },
      accepts: [
        {
          providerId: "example",
          methodId: "unique-human",
          descriptorVersion: "1",
          acceptedScopeKinds: ["relying_party"],
        },
      ],
    });
    const header = encodeHumanRequirement(requirement);
    const conflictingBody = {
      type: "https://x424.org/problems/human-required",
      title: "Unique human required",
      status: 424,
      detail: "dependency",
      dependencyId: "another-dependency",
      x424Transport: "header",
    };
    expect(() =>
      requirementFromChallenge({
        headers: new Headers({ "human-required": header }),
        body: conflictingBody,
      }),
    ).toThrow(/conflicting/);
    expect(() =>
      requirementFromChallenge({
        headers: new Headers({ "human-required": "a".repeat(8_193) }),
        body: null,
      }),
    ).toThrow(/interop envelope/);
    const nonCanonical = encodeStrictBase64Url(
      Buffer.from('{ "a": 1 }', "utf8"),
    );
    expect(() => decodeX424Header(nonCanonical)).toThrow(/Non-canonical/);
  });

  it("does not allow an origin-relative URI to escape publicOrigin", () => {
    expect(() =>
      resolvePublicAbsoluteUri({
        config: { publicOrigin: "https://api.example.test" },
        pathWithQuery: "//evil.example/steal",
      }),
    ).toThrow(/unambiguous/);
    expect(() =>
      resolvePublicAbsoluteUri({
        config: { publicOrigin: "https://api.example.test" },
        pathWithQuery: "/safe#fragment",
      }),
    ).toThrow(/unambiguous/);
  });
});

describe("verifier redirect proof leakage", () => {
  it("never forwards nativeProof on 301/302/303/307/308", async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      const seen: string[] = [];
      const fetchImplementation = vi.fn(async (request: Request) => {
        seen.push(request.url);
        if (request.url.includes("/verify")) {
          await request.text();
          return new Response(null, {
            status,
            headers: { location: "https://evil.example/collect" },
          });
        }
        throw new Error(`unexpected fetch ${request.url}`);
      });
      const resolver = createHttpHumanDependencyResolver({
        verifierUrl: "https://verifier.example.test/",
        fetchImplementation: fetchImplementation as unknown as typeof fetch,
        resolveProviderProof: async () => ({
          providerId: "example",
          methodId: "unique-human",
          descriptorVersion: "1",
          nativeProof: { secret: "raw-proof-material" },
        }),
      });
      const requirement = createHumanRequirement({
        purpose: "publish-record",
        method: "POST",
        uri: "https://api.example.test/records",
        audience: "https://api.example.test",
        binding: { kind: "agent_key", value: "sha256:agent" },
        accepts: [
          {
            providerId: "example",
            methodId: "unique-human",
            descriptorVersion: "1",
            acceptedScopeKinds: ["relying_party"],
          },
        ],
      });
      await expect(
        resolver({
          requirement,
          response: new Response(null, { status: 424 }),
        }),
      ).rejects.toThrow(/redirect/);
      expect(seen.some((url) => url.includes("evil.example"))).toBe(false);
    }
  });
});

describe("privacy-safe telemetry", () => {
  it("redacts nested nullifier_hash and error messages", () => {
    const redacted = redactForTelemetry({
      nullifier_hash: "0xsecret",
      nested: { native_proof: { proof: "raw" } },
      err: new Error("nullifier=0xsecret token=abc"),
    }) as Record<string, unknown>;
    expect(redacted.nullifier_hash).toBe("[redacted]");
    expect((redacted.nested as Record<string, unknown>).native_proof).toBe(
      "[redacted]",
    );
    expect((redacted.err as { message: string }).message).toBe(
      "[redacted-error-message]",
    );
    expect(() =>
      assertNoSensitiveLeak(JSON.stringify({ nullifier_hash: "x" })),
    ).toThrow();
  });
});

describe("requestDigest stability", () => {
  it("keeps JSON digests distinct from non-canonical opaque bytes", () => {
    const json = requestDigest({
      method: "POST",
      uri: "https://api.example.test/x",
      bodyInput: { kind: "json", value: { a: 1 } },
    });
    const opaque = requestDigest({
      method: "POST",
      uri: "https://api.example.test/x",
      bodyInput: {
        kind: "opaque",
        bytes: new TextEncoder().encode('{ "a": 1 }'),
      },
    });
    expect(json).not.toBe(opaque);
  });
});
