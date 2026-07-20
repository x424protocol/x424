import { describe, expect, it } from "vitest";
import {
  X424_HEADER_INTEROP_ENVELOPE_BYTES,
  assertChallengeRequestMatch,
  assertHeaderSize,
  bodyDigestFromInput,
  buildCorsHeaders,
  isCrossOriginRedirect,
  requestDigest,
  selectRequirementTransportMode,
  sha256,
} from "../src/core.js";

describe("transport profile", () => {
  it("selects body transport above the interop envelope", () => {
    expect(selectRequirementTransportMode(100)).toBe("header");
    expect(
      selectRequirementTransportMode(X424_HEADER_INTEROP_ENVELOPE_BYTES + 1),
    ).toBe("body");
    expect(() => selectRequirementTransportMode(70_000)).toThrow(/absolute/);
  });

  it("builds CORS headers only for allowlisted origins", () => {
    expect(
      buildCorsHeaders("https://evil.example", {
        allowedOrigins: ["https://app.example"],
      }),
    ).toBeNull();
    const headers = buildCorsHeaders("https://app.example", {
      allowedOrigins: ["https://app.example"],
      allowCredentials: true,
    });
    expect(headers?.["access-control-allow-origin"]).toBe(
      "https://app.example",
    );
    expect(headers?.["access-control-expose-headers"]).toContain(
      "HUMAN-REQUIRED",
    );
    expect(headers?.["access-control-allow-credentials"]).toBe("true");
  });

  it("rejects cross-origin challenge mismatches", () => {
    expect(() =>
      assertChallengeRequestMatch({
        requestMethod: "POST",
        requestUrl: "https://api.example.test/records",
        challengeUrl: "https://other.example.test/records",
        resourceMethod: "POST",
        resourceUri: "https://other.example.test/records",
      }),
    ).toThrow(/origin boundary/);
  });

  it("detects cross-origin redirects", () => {
    expect(
      isCrossOriginRedirect(
        "https://api.example.test/a",
        "https://evil.example/a",
      ),
    ).toBe(true);
    expect(
      isCrossOriginRedirect(
        "https://api.example.test/a",
        "https://api.example.test/b",
      ),
    ).toBe(false);
  });

  it("caps header size", () => {
    expect(() => assertHeaderSize("")).toThrow();
    expect(() => assertHeaderSize("x".repeat(70_000))).toThrow();
  });
});

describe("request body digests", () => {
  it("treats empty and absent bodies as null bodyDigest", () => {
    expect(bodyDigestFromInput({ kind: "absent" })).toBeNull();
    expect(bodyDigestFromInput({ kind: "empty" })).toBeNull();
    expect(
      requestDigest({
        method: "POST",
        uri: "https://api.example.test/x",
        bodyInput: { kind: "empty" },
      }),
    ).toBe(
      requestDigest({
        method: "POST",
        uri: "https://api.example.test/x",
        bodyInput: { kind: "absent" },
      }),
    );
  });

  it("digests opaque bytes", () => {
    const bytes = new TextEncoder().encode("raw-bytes");
    expect(bodyDigestFromInput({ kind: "opaque", bytes })).toBe(sha256(bytes));
  });

  it("fails closed for streams without precomputed digest", () => {
    expect(() => bodyDigestFromInput({ kind: "stream" })).toThrow(
      /fail closed/,
    );
  });
});
