# ADR-0001: HTTP transport compatibility profile

- Status: review-pending
- Date: 2026-07-19
- Updated: 2026-07-20
- Decision makers: Protocol lead (implementation proposal)
- Required reviewers: independent protocol reviewer (not yet recorded)
- Requirement IDs: X424-HTTP-001..011, X424-PRIV-003

## Context

Intermediaries truncate headers; browsers enforce CORS; redirects can leak
challenges. x424/0.1 needs an explicit, fail-closed transport profile.

## Alternatives

1. Keep headers-only with a 64 KiB implementation max and no alternate transport.
2. Always use body transport and deprecate headers.
3. **Selected for implementation:** Keep HUMAN-REQUIRED inline headers within an
   8 KiB encoded envelope; carry larger requirements in the 424 problem body
   (`x424Transport: "body"`). Reference-URL transport is **not** supported in
   0.1 and is removed from the mode union until specified with integrity,
   HTTPS, and redirect rules.

## Decision

- Canonical challenge remains HTTP 424 + Problem Details +
  `Cache-Control: no-store, private` + `Vary: HUMAN-PROOF`.
- **Inline envelope:** 8,192 UTF-8 bytes of the encoded header value.
- Above the envelope, servers MUST NOT emit `HUMAN-REQUIRED`; they MUST set
  `x424Transport: "body"` and include the full `requirement` object in the
  problem body.
- Problem bodies MUST name exactly one transport: a `header` body cannot embed
  a requirement, while a `body` requirement's dependencyId must match the
  enclosing problem. Clients reject conflicting header/body representations.
- Absolute maximum encoded requirement size remains 65,536 bytes.
- CORS: exact origin allowlists; expose `HUMAN-REQUIRED`, `HUMAN-PROOF`,
  `HUMAN-RESULT` when used.
- Clients MUST use `redirect: "manual"` for challenge detection and verifier
  proof submission; cross-origin and opaque redirects fail closed; nativeProof
  is never resent after any redirect.
- x424 extends RFC 4918 status 424 semantics; it does not claim WebDAV
  conformance.

## Security impact

Prevents oversized-header truncation ambiguity and redirect proof leakage.
Does not accept more proofs.

## Privacy impact

No change to proof/nullifier boundary. Body transport uses the same no-store
caching rules.

## Compatibility and migration

Header-only clients remain valid under 8 KiB. Clients must also accept body
transport. Unsupported mode `reference` fails closed if encountered.

## Negative vectors / tests

Implemented locally:

- `transport-header-over-envelope-uses-body` (test/security-regressions)
- `transport-cors-disallowed-origin` (test/transport)
- `transport-redirect-cross-origin-proof` (test/security-regressions)
- `transport-challenge-uri-mismatch` (test/transport, client)
- `transport-conflicting-or-oversized-inline-rejected` (test/security-regressions)

## Unresolved risks

Full intermediary lab matrix and independent protocol review remain open.
This ADR is not self-approved.
