# Changelog

All notable implementation and protocol-profile changes are recorded here.
Wire compatibility remains governed by `docs/PROTOCOL.md` and
`docs/GOVERNANCE.md`.

## Unreleased

### Added

- Redis-backed atomic requirement, dependency nonce, provider-subject, and
  result-replay state.
- Injectable requirement storage for the Express verifier router.
- Generic HTTP verifier resolver for provider-proof submission.
- Signed World RP request construction and World proof resolver helpers.
- IDKit Proof of Human request and collection helper for browser and wallet
  clients.
- Explicit `world:orb-legacy@1` fallback method within the same IDKit Proof of
  Human ceremony.
- Reusable World verifier profile assembly for catalogs, accepted methods,
  provider requests, and adapter configuration.
- Atomic provider-subject replay interfaces with in-memory and Redis stores;
  stores receive only an HMAC digest, never the raw provider nullifier.
- Public adopter contract and measurable standards-readiness roadmap.
- Provenance-enabled npm release workflow with packed-package smoke tests.

### Changed

- Updated the reference World profile to preserve current Proof of Human and
  legacy Orb as separate immutable method outcomes.
- Enforced World protocol version, environment, RP/action, nonce, credential,
  and x424 binding signal before remote verification.
- Made legacy fallback opt-in at the requirement, trusted provider request, and
  verifier profile while keeping one client ceremony.
- Required the World adapter to validate the v4 issuer schema, native
  nullifier, exact remote nullifier, and legacy signal binding.
- Required `X424Service` deployments to provide an atomic provider replay store
  in addition to dependency nonce state; subjects are consumed only for methods
  that declare verifier-side retention.
- Required client proof resolvers to match the accepted immutable descriptor
  version before starting a provider ceremony.
