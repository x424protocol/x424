import { describe, expect, it } from "vitest";
import { canonicalJson, requestDigest, sha256 } from "../src/core.js";

describe("canonicalization property checks", () => {
  it("key order does not change digest", () => {
    const a = canonicalJson({ z: 1, a: { c: 3, b: 2 } });
    const b = canonicalJson({ a: { b: 2, c: 3 }, z: 1 });
    expect(a).toBe(b);
    expect(sha256(a)).toBe(sha256(b));
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(/Non-finite/);
    expect(() => canonicalJson({ n: Number.POSITIVE_INFINITY })).toThrow(
      /Non-finite/,
    );
  });

  it("unicode strings are stable", () => {
    const value = { msg: "café 😀" };
    expect(canonicalJson(value)).toBe(canonicalJson({ msg: "café 😀" }));
  });

  it("method case normalizes in requestDigest", () => {
    expect(
      requestDigest({ method: "post", uri: "https://example.test/x" }),
    ).toBe(requestDigest({ method: "POST", uri: "https://example.test/x" }));
  });
});
