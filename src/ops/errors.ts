/**
 * Stable public problem responses. Never echo adapter/provider diagnostics.
 */

import { redactForTelemetry } from "./redaction.js";

export interface PublicProblem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code: string;
}

export type InternalObserver = (event: {
  readonly code: string;
  readonly status: number;
  readonly redacted: unknown;
}) => void;

const PUBLIC_DETAILS: Readonly<Record<string, string>> = {
  UNAUTHENTICATED: "Authentication required",
  PURPOSE_NOT_AUTHORIZED: "Issuer is not authorized for this request",
  AUDIENCE_NOT_AUTHORIZED: "Issuer is not authorized for this request",
  RESOURCE_NOT_AUTHORIZED: "Issuer is not authorized for this request",
  METHOD_NOT_AUTHORIZED: "Issuer is not authorized for this request",
  HTTP_METHOD_NOT_AUTHORIZED: "Issuer is not authorized for this request",
  INVALID_REQUIREMENT: "Request body is invalid",
  REQUIREMENT_REJECTED: "Requirement rejected",
  MISCONFIGURED_ISSUER: "Verifier is misconfigured",
  RATE_LIMITED: "Rate limit exceeded",
  INVALID_DEPENDENCY: "Invalid dependency",
  DEPENDENCY_NOT_FOUND: "Unknown dependency",
  INVALID_PROOF: "Proof body is invalid",
  PROOF_REJECTED: "Proof rejected",
  HUMAN_PROOF_REJECTED: "Human proof rejected",
  CORS_ORIGIN_DENIED: "Origin is not allowed",
  IDEMPOTENCY_KEY_REQUIRED: "Idempotency-Key is required for mutations",
  NOT_FOUND: "Not found",
};

export function publicProblem(
  status: number,
  code: string,
  detailOverride?: string,
): PublicProblem {
  const detail =
    detailOverride ?? PUBLIC_DETAILS[code] ?? "Request could not be completed";
  return {
    type: `https://x424.org/problems/${code.toLowerCase().replaceAll("_", "-")}`,
    title: code,
    status,
    detail: detail.slice(0, 200),
    code,
  };
}

/** Map thrown errors to stable public codes without leaking messages. */
export function classifyVerifierError(error: unknown): {
  readonly status: number;
  readonly code: string;
} {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code: unknown }).code);
    if (code === "UNAUTHENTICATED") return { status: 401, code };
    if (code.endsWith("_NOT_AUTHORIZED")) return { status: 403, code };
  }
  const message = error instanceof Error ? error.message : "";
  if (/rate limit/i.test(message)) return { status: 429, code: "RATE_LIMITED" };
  if (/unknown dependency|expired human dependency/i.test(message)) {
    return { status: 404, code: "DEPENDENCY_NOT_FOUND" };
  }
  if (/already consumed|replay/i.test(message)) {
    return { status: 401, code: "HUMAN_PROOF_REJECTED" };
  }
  if (/misconfigured|ResultReplayStore|deploymentProfile/i.test(message)) {
    return { status: 500, code: "MISCONFIGURED_ISSUER" };
  }
  return { status: 422, code: "PROOF_REJECTED" };
}

export function observeInternal(
  observer: InternalObserver | undefined,
  code: string,
  status: number,
  error: unknown,
): void {
  if (!observer) return;
  observer({
    code,
    status,
    redacted: redactForTelemetry({
      name: error instanceof Error ? error.name : "Error",
      // Never pass raw message; only a redacted structural view.
      error:
        error instanceof Error ? { name: error.name } : { kind: typeof error },
    }),
  });
}
