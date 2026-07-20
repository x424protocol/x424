/**
 * Proof-safe telemetry helpers. Never log raw proofs, nullifiers, or secrets.
 */

const SENSITIVE_KEY =
  /^(native_?proof|nativeProof|proof|nullifier(_?hash)?|provider_?subject|providerSubject|pairwise_?secret|pairwiseSecret|private_?key|privateKey|signing_?key(_?hex)?|signingKey(Hex)?|signal|merkle_?root|credential_?type|authorization|bearer|token|secret|password|seed)$/i;

const SENSITIVE_SUBSTRING =
  /nullifier|nativeproof|native_proof|pairwisesecret|private.?key|signingkey|bearer\s+[a-z0-9._-]+/i;

export function normalizeKey(key: string): string {
  return key.replace(/[-_]/g, "").toLowerCase();
}

function keyIsSensitive(key: string): boolean {
  if (SENSITIVE_KEY.test(key)) return true;
  const normalized = normalizeKey(key);
  return [
    "nativeproof",
    "proof",
    "nullifier",
    "nullifierhash",
    "providersubject",
    "pairwisesecret",
    "privatekey",
    "signingkey",
    "signingkeyhex",
    "signal",
    "merkleroot",
    "authorization",
    "token",
    "secret",
  ].includes(normalized);
}

export function redactForTelemetry(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (value instanceof Error) {
    return {
      name: value.name,
      message: "[redacted-error-message]",
    };
  }
  if (value === null || typeof value !== "object") {
    if (typeof value === "string") {
      if (SENSITIVE_SUBSTRING.test(value) || value.length > 256) {
        return `[redacted-string:${value.length}]`;
      }
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
    if (keyIsSensitive(key)) {
      output[key] = "[redacted]";
      continue;
    }
    output[key] = redactForTelemetry(child, depth + 1);
  }
  return output;
}

export function assertNoSensitiveLeak(text: string): void {
  if (SENSITIVE_SUBSTRING.test(text)) {
    throw new Error("Sensitive field leaked into output");
  }
  const lowered = text.toLowerCase();
  for (const needle of [
    "nullifier_hash",
    "nullifier",
    "nativeproof",
    "native_proof",
    "pairwisesecret",
    "private_key",
    "signingkeyhex",
    "-----begin",
  ]) {
    if (lowered.includes(needle)) {
      throw new Error(`Sensitive field leaked into output: ${needle}`);
    }
  }
}
