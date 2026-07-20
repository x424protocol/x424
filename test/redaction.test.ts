import { describe, expect, it } from "vitest";
import { assertNoSensitiveLeak, redactForTelemetry } from "../src/core.js";

describe("proof-safe redaction", () => {
  it("redacts native proofs and nullifiers", () => {
    const redacted = redactForTelemetry({
      dependencyId: "x424_dep",
      nativeProof: { nullifier: "secret", proof: "raw" },
      providerSubject: "should-not-leak",
    }) as Record<string, unknown>;
    expect(redacted.nativeProof).toBe("[redacted]");
    expect(redacted.providerSubject).toBe("[redacted]");
    expect(redacted.dependencyId).toBe("x424_dep");
  });

  it("detects sensitive substrings in serialized output", () => {
    expect(() => assertNoSensitiveLeak('{"nullifier":"x"}')).toThrow(
      /nullifier/,
    );
  });
});
