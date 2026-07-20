# Changelog

All notable implementation and protocol-profile changes are recorded here.
Wire compatibility remains governed by `docs/PROTOCOL.md` and
`docs/GOVERNANCE.md`.

## Unreleased

### Added

- Redis-backed atomic requirement, nonce, and result-replay state.
- Injectable requirement storage for the Express verifier router.
- Generic HTTP verifier resolver for provider-proof submission.
- Signed World RP request construction and World proof resolver helpers.
- IDKit Proof of Human request and collection helper for browser and wallet
  clients.
- Public adopter contract and measurable standards-readiness roadmap.
- Provenance-enabled npm release workflow with packed-package smoke tests.

### Changed

- Updated the reference World profile to the current Proof of Human method.
- Enforced World protocol version, environment, RP/action, nonce, credential,
  and x424 binding signal before remote verification.
- Restricted the World method to current v4 `proof_of_human` credentials;
  legacy credentials require a separately versioned cross-version
  deduplication profile.
- Required client proof resolvers to match the accepted immutable descriptor
  version before starting a provider ceremony.
