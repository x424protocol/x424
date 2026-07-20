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
      /Sensitive field leaked/,
    );
  });

  it("redacts brokered-handoff capabilities, presentation, and provider state", () => {
    const redacted = redactForTelemetry({
      handoffId: "handoff-public",
      accessToken: "capability-secret",
      accessTokenDigest: "sha256:private",
      presentation: { kind: "uri", uri: "https://connector.example/private" },
      providerSession: { requestId: "private" },
      protectedState: "ciphertext",
      humanProof: "signed-result",
    }) as Record<string, unknown>;
    expect(redacted).toEqual({
      handoffId: "handoff-public",
      accessToken: "[redacted]",
      accessTokenDigest: "[redacted]",
      presentation: "[redacted]",
      providerSession: "[redacted]",
      protectedState: "[redacted]",
      humanProof: "[redacted]",
    });
  });
});
