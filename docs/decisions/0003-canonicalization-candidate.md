# ADR-0003: Interoperability-candidate canonicalization and version negotiation

- Status: review-pending
- Date: 2026-07-19
- Updated: 2026-07-20
- Decision makers: Protocol lead (implementation proposal)
- Required reviewers: independent implementer (not yet recorded)
- Requirement IDs: X424-REQ-003, X424-VERNEG-001..004, X424-CONF-001

## Context

Independent implementations need frozen byte inputs. Current helper sorts object
keys and rejects non-finite numbers; it does not claim RFC 8785.

## Decision

- Profile ID: `x424-canon-0.1`
- Byte inputs for digests and JWS payloads use `canonicalJson` UTF-8.
- Unsupported `x424Version` fails closed.
- Wire schemas remain `additionalProperties: false` / Zod `.strict()`.
- Result token algorithm allowlist: `EdDSA` + `typ: x424-result+jws` only.
- Base64url decoding is strict (alphabet, no padding, canonical round-trip).
- Downgrade: configured minimum version must not accept lower versions.

## Negative vectors / tests

- `canon-non-finite-number`
- `canon-key-order-invariant`
- `canon-unicode-stable`
- `encoding-e30$-rejected`
- `alg-confusion-rejected` (via result-token header checks)

## Unresolved risks

Formal RFC 8785 adoption and cross-language differential tests remain externally
dependent. This ADR is not self-approved.
