/**
 * Proof-safe telemetry helpers. Never log raw proofs, nullifiers, or secrets.
 */

const SENSITIVE_KEY =
  /^(nativeProof|proof|nullifier|providerSubject|pairwiseSecret|privateKey|signingKey|signal|merkle_root|credential_type)$/i;

export function redactForTelemetry(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && value.length > 256) {
      return `[redacted-string:${value.length}]`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => redactForTelemetry(item, depth + 1));
  }
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      output[key] = "[redacted]";
      continue;
    }
    output[key] = redactForTelemetry(child, depth + 1);
  }
  return output;
}

export function assertNoSensitiveLeak(text: string): void {
  const lowered = text.toLowerCase();
  for (const needle of [
    "nullifier",
    "nativeproof",
    "pairwisesecret",
    "private_key",
    "signingkeyhex",
  ]) {
    if (lowered.includes(needle)) {
      throw new Error(`Sensitive field leaked into output: ${needle}`);
    }
  }
}
