# ADR-0001: HTTP transport compatibility profile

- Status: accepted
- Date: 2026-07-19
- Decision makers: Protocol lead (program baseline)
- Requirement IDs: X424-HTTP-001..011, X424-PRIV-003

## Context

Intermediaries truncate headers; browsers enforce CORS; redirects can leak
challenges. x424/0.1 needs an explicit, fail-closed transport profile before
independent implementations freeze behavior.

## Alternatives

1. Keep headers-only with a 64 KiB implementation max and no alternate transport.
2. Always use body/`application/x424-requirement+json` and deprecate headers.
3. **Selected:** Keep HUMAN-REQUIRED inline headers with a conservative envelope;
   offer a versioned `requirementRef` / body transport when the encoded
   requirement exceeds the conservative limit or intermediaries strip headers.

## Decision

- Canonical challenge remains HTTP 424 + `HUMAN-REQUIRED` + Problem Details +
  `Cache-Control: no-store, private` + `Vary: HUMAN-PROOF`.
- **Conservative inline envelope:** 8 KiB encoded header value for
  interoperability-candidate profiles; reference implementation continues to
  reject above 64 KiB absolute max.
- Above 8 KiB, issuers SHOULD use transport mode `body` or `reference`
  (`x424Transport` extension on the problem body / requirement envelope) without
  weakening integrity, expiry, or cache rules.
- CORS (resource and verifier browser surfaces): explicit allowlist; expose
  `HUMAN-REQUIRED`, `HUMAN-PROOF`, `HUMAN-RESULT`; credentialed requests only
  for explicit origins; preflight must allow those headers.
- Redirects: clients MUST NOT follow cross-origin redirects when attaching
  `HUMAN-PROOF` or when reading `HUMAN-REQUIRED` for retry; challenge URI must
  match the request URI used for digest binding.
- x424 extends RFC 4918 status 424 semantics; it does not claim WebDAV
  conformance.

## Security impact

Reduces truncation/smuggling ambiguity; prevents credentialed CORS reflection;
blocks cross-origin proof forwarding. Does not accept more proofs.

## Privacy impact

No change to proof/nullifier boundary. Alternate transport must use same
no-store caching rules.

## Compatibility and migration

Header-only clients remain valid under 8 KiB. Larger requirements need 0.1
transport mode fields documented in PROTOCOL and schemas. Unsupported modes
fail closed.

## Negative vectors / tests

- `transport-header-over-absolute-max`
- `transport-cors-disallowed-origin`
- `transport-redirect-cross-origin-proof`
- `transport-challenge-uri-mismatch`

## Unresolved risks

Full intermediary lab matrix (nginx/Envoy/Cloudflare/browsers) still requires
empirical measurement; limits may tighten via a new ADR without silent
reinterpretation of existing vectors.
