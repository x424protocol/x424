# ADR-0003: Interoperability-candidate canonicalization and version negotiation

- Status: accepted
- Date: 2026-07-19
- Decision makers: Protocol lead (program baseline)
- Requirement IDs: X424-REQ-003, X424-VERNEG-001..004, X424-CONF-001

## Context

Independent implementations need frozen byte inputs. Current helper sorts object
keys and rejects non-finite numbers; it does not claim RFC 8785.

## Alternatives

1. Declare RFC 8785 immediately and rewrite all vectors.
2. Leave prose-only rules until 1.0.
3. **Selected:** Publish `x424-canon-0.1` as interoperability candidate: sorted
   keys, UTF-8 JSON.stringify after normalize, reject non-finite numbers,
   undefined object members omitted, no additional properties coercion in
   schemas. Phase 5 may ratify or version; must not silently reinterpret.

## Decision

- Profile ID: `x424-canon-0.1`
- Byte inputs for digests and JWS payloads use `canonicalJson` output UTF-8.
- Protocol version negotiation: unsupported `x424Version` fails closed.
- Unknown fields on wire objects: schemas `.strict()` / `additionalProperties:
false`; unknown **critical** extensions (when introduced) fail closed.
- Algorithm allowlist for result tokens: `EdDSA` only with `typ:
x424-result+jws` in 0.1.
- Provider namespaces: lowercase identifier syntax; ownership documented in
  provider profile; not trademark clearance.
- Downgrade: a client or verifier MUST NOT accept a lower protocol version than
  configured policy when policy pins a minimum.

## Security impact

Prevents algorithm confusion and permissive parsing. Ambiguity fails closed.

## Privacy impact

None beyond existing result minimization.

## Compatibility and migration

Vectors already lock current bytes. Expanded nested/Unicode/numeric vectors
added under the same profile ID. Changing normalize rules requires new profile
ID and protocol version as applicable.

## Negative vectors / tests

- `canon-non-finite-number`
- `canon-key-order-invariant`
- `canon-unicode-escape-roundtrip`
- `version-unsupported-rejected`
- `alg-confusion-rejected`

## Unresolved risks

Formal RFC 8785 adoption deferred; differential tests vs other languages still
externally dependent (P4B-02).
