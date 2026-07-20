import { randomBytes, randomUUID } from "node:crypto";
import { requestDigest } from "./canonical.js";
import { isHumanMethodIdentifier, methodKey } from "./catalog.js";
import type {
  HumanBinding,
  HumanMethodRequirement,
  HumanRequirement,
} from "./types.js";
import { X424_VERSION } from "./types.js";

export function createHumanRequirement(input: {
  readonly purpose: string;
  readonly method: string;
  readonly uri: string;
  readonly audience: string;
  readonly body?: unknown;
  readonly binding: HumanBinding;
  readonly accepts: readonly HumanMethodRequirement[];
  readonly providerRequests?: Readonly<Record<string, unknown>>;
  readonly ttlSeconds?: number;
  readonly dependencyId?: string;
  readonly nonce?: string;
  readonly now?: Date;
}): HumanRequirement {
  if (!input.purpose || !input.audience || input.accepts.length === 0) {
    throw new Error("Purpose, audience, and one accepted method are required");
  }
  const acceptedKeys = new Set<string>();
  for (const accepted of input.accepts) {
    if (
      !isHumanMethodIdentifier(accepted.providerId) ||
      !isHumanMethodIdentifier(accepted.methodId)
    ) {
      throw new Error("Accepted human method identifiers are invalid");
    }
    const key = methodKey(accepted.providerId, accepted.methodId);
    if (acceptedKeys.has(key)) {
      throw new Error(`Duplicate accepted human method: ${key}`);
    }
    acceptedKeys.add(key);
  }
  const now = input.now ?? new Date();
  const ttlSeconds = input.ttlSeconds ?? 300;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 900) {
    throw new Error("Requirement TTL must be between 30 and 900 seconds");
  }
  return {
    x424Version: X424_VERSION,
    dependencyId: input.dependencyId ?? `x424_dep_${randomUUID()}`,
    purpose: input.purpose,
    resource: {
      method: input.method.toUpperCase(),
      uri: input.uri,
      audience: input.audience,
      requestDigest: requestDigest({
        method: input.method,
        uri: input.uri,
        ...(input.body === undefined ? {} : { body: input.body }),
      }),
    },
    nonce: input.nonce ?? randomBytes(32).toString("base64url"),
    binding: input.binding,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1_000).toISOString(),
    accepts: [...input.accepts],
    ...(input.providerRequests
      ? { providerRequests: input.providerRequests }
      : {}),
  };
}
