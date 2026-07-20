# Changelog

All notable implementation and protocol-profile changes are recorded here.
Wire compatibility remains governed by `docs/PROTOCOL.md` and
`docs/GOVERNANCE.md`.

## Unreleased

### Fixed

- Closed the x424-before-x402 replay gap: mutation results now permit only the
  same result, idempotency key, and exact request digest across the 402 retry;
  any different operation is replay.
- Successful direct and brokered verification now retains the requirement
  until resource acceptance instead of deleting the policy state before the
  returned result can be evaluated. Failed proof attempts still fail closed.

- The local World fixture flow now keeps verifier and resource requirement
  state separate, permits HTTP only for localhost evaluation, supplies the
  accepted World assurance label, and fails unless the protected retry returns
  `201`.
- The landing page now uses valid responsive width calculations instead of
  clipping desktop content on mobile viewports.

### Security

- Added capability-scoped brokered handoff with digest-only capability
  storage, encrypted provider state/completion, one active handoff per
  dependency, and atomic compare-and-swap polling.
- Added the `x424-agent` HTTP Message Signatures profile with ≤60-second
  signatures, exact method/URI/body/proof/payment coverage, dependency nonce,
  Ed25519 JWK thumbprints, EIP-191 CAIP-10 keys, and ERC-1271 magic-value
  validation.

- Resource middleware now re-validates current method, URI, body digest,
  audience, purpose, and caller binding before accepting HUMAN-PROOF; eval/prod
  require ResultReplayStore; publicOrigin replaces trusted X-Forwarded-* defaults.
- Verifier proof submission uses redirect:manual, pins verifier origin, never
  resends nativeProof after redirects, and requires HTTPS outside localhost opt-in.
- Explicit body digest kinds; no inference of Blob/Date/class instances as JSON;
  strict SHA-256 precomputed digest validation.
- Body transport for requirements over the 8 KiB header envelope; never emit
  oversized HUMAN-REQUIRED.
- Strict base64url/JWS/metadata parsing with canonical round-trip checks.
- Issuance authorization denies by default; empty grants deny; URI grants use
  origin+path boundaries and reject encoded path traversal; deploymentProfile is
  mandatory.
- Public problem responses no longer echo adapter/provider error messages;
  redaction covers snake_case/nullifier_hash and Error objects.
- Wire digests require canonical `sha256:` + 32-byte base64url; issuance API
  accepts explicit `bodyInput` kinds.

### Added

- `ResultAcceptanceStore` with in-memory, Redis, PostgreSQL, managed-verifier,
  and authenticated HTTP acceptance adapters.
- `x424/handoff`, public handoff endpoints, managed client methods, Redis and
  PostgreSQL handoff stores, and a public-IDKit World handoff adapter.
- `x424/agent`, `createX424AgentClient()`, callback/terminal/NDJSON presenters,
  and the `x424-agent` CLI with shell-free external signer execution and stable
  exit codes.
- AgentKit prior-art acknowledgment pinned to its reviewed public commit;
  AgentKit remains absent from core dependencies and runtime.

- A one-command, CI-enforced local quickstart plus public maturity/evidence
  matrix for developer onboarding.
- Adoption-oriented website sections for provider-vs-x424 selection,
  responsibility boundaries, quickstart, and honest release status.
- A focused `test:adopter-contract` command for automated adopter compatibility
  gates covering valid World verification, request binding, replay rejection,
  provider-request policy, privacy, and public HTTP behavior.
- High-level `createX424()` and `worldProofOfHuman()` entry points plus stable
  Fetch, Express, Next.js, managed-verifier, World, and x402 package subpaths.
- Authenticated `ManagedVerifierClient` with remote issuance, retained
  requirement, and atomic result-consumption adapters.
- Deterministic x424-before-x402 server/client composition with three-request
  body replay controls and separate human/payment proof headers.
- Runnable non-root Redis verifier image, shared Redis rate limiter, production
  external signer/deriver boundary, Compose sandbox, and Helm templates.

- Program baseline controls under `docs/program/` (severity policy, deployment
  profiles, conflict governance, threat/data-flow, requirement IDs, deliverable
  register, external engagement packages).
- Decision records ADR-0001..0004 (status: review-pending until independent
  approval) for transport, body digests, canonicalization, and package topology.
- HTTP transport helpers (CORS, header envelope, redirect safety) and expanded
  request body digest profiles (`x424-canon-0.1`).
- Authenticated issuance authorization interface and static bearer profile.
- Signed verifier metadata document helpers with key validity/revocation checks.
- KMS/HSM-oriented external result signing and pairwise secret version helpers.
- Express and Fetch resource middleware with Idempotency-Key default on mutations.
- PostgreSQL transactional state store profile and schema DDL.
- Rate limiter, circuit breaker, provider egress allowlist, and proof-safe
  redaction helpers.
- Verifier container skeleton (`deploy/verifier`) with health/ready probes.
- Black-box conformance CLI scaffold (`x424-conformance`).
- World browser local-stack example using public APIs with legacy disabled.
- Operational runbooks for key compromise, provider outage, state restore, abuse.
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

- Production mutations require `ResultAcceptanceStore` and
  `Idempotency-Key`; `ResultReplayStore` remains for reads and 0.1
  compatibility.
- Documented the public IDKit session-resume limitation: unexpected verifier
  restart fails active World handoffs closed with `WORLD_SESSION_LOST` and
  remains outside the `prod-ha-0.2` gate.

- Standardized public maturity language on “x424/0.1 developer preview ·
  unaudited” and aligned README, website, security, roadmap, and package-facing
  discovery copy.
- Authenticated issuance can use exactly one provider-request source:
  verifier-generated or adopter-supplied signed material validated by the
  provider adapter before nonce registration.
- PostgreSQL requirement/nonce insertion now rejects duplicate dependency IDs,
  and provider replay keys include provider, method, scope, and private digest.

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
