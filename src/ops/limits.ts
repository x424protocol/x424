/**
 * Rate limits, circuit breakers, and provider egress allowlists (P2-06).
 */

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetAt: number;
}

export interface MemoryRateLimiterOptions {
  readonly windowMs: number;
  readonly maxRequests: number;
}

export class MemoryRateLimiter {
  readonly #windowMs: number;
  readonly #max: number;
  readonly #hits = new Map<string, number[]>();

  constructor(options: MemoryRateLimiterOptions) {
    this.#windowMs = options.windowMs;
    this.#max = options.maxRequests;
  }

  consume(key: string, now = Date.now()): RateLimitResult {
    const windowStart = now - this.#windowMs;
    const prior = (this.#hits.get(key) ?? []).filter((ts) => ts > windowStart);
    if (prior.length >= this.#max) {
      this.#hits.set(key, prior);
      const resetAt = (prior[0] ?? now) + this.#windowMs;
      return { allowed: false, remaining: 0, resetAt };
    }
    prior.push(now);
    this.#hits.set(key, prior);
    return {
      allowed: true,
      remaining: Math.max(0, this.#max - prior.length),
      resetAt: now + this.#windowMs,
    };
  }
}

export interface CircuitBreakerOptions {
  readonly failureThreshold: number;
  readonly coolDownMs: number;
}

export class CircuitBreaker {
  readonly #failureThreshold: number;
  readonly #coolDownMs: number;
  #failures = 0;
  #openedAt: number | null = null;

  constructor(options: CircuitBreakerOptions) {
    this.#failureThreshold = options.failureThreshold;
    this.#coolDownMs = options.coolDownMs;
  }

  assertClosed(now = Date.now()): void {
    if (this.#openedAt !== null) {
      if (now - this.#openedAt < this.#coolDownMs) {
        throw new Error("Provider circuit open");
      }
      this.#openedAt = null;
      this.#failures = 0;
    }
  }

  recordSuccess(): void {
    this.#failures = 0;
    this.#openedAt = null;
  }

  recordFailure(now = Date.now()): void {
    this.#failures += 1;
    if (this.#failures >= this.#failureThreshold) {
      this.#openedAt = now;
    }
  }
}

export function assertProviderEgressAllowed(
  url: string,
  allowlist: readonly string[],
): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid provider egress URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Provider egress must use https");
  }
  const origin = parsed.origin;
  if (!allowlist.includes(origin)) {
    throw new Error("Provider origin is not allowlisted");
  }
}
