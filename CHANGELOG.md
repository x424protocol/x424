# Changelog

All notable implementation and protocol-profile changes are recorded here.
Wire compatibility remains governed by `docs/PROTOCOL.md` and
`docs/GOVERNANCE.md`.

## Unreleased

## 0.1.4 - 2026-07-27

### Security

- Added a durable Redis-backed, pre-authentication network limit to the
  protected verifier-metadata route. Limiter failures now fail closed, and
  throttled attempts receive `429` with `Retry-After`.
- Applied `Cache-Control: no-store, private` and `Vary: Authorization` to every
  verifier-metadata outcome, including authentication, throttling, and
  dependency-failure responses.
- Required `prod-ha-0.2` static bearer credentials to be canonical
  hexadecimal, base64, or base64url encodings of at least 32 bytes; operators
  must generate those bytes with a cryptographically secure random source.
  Limiter keys contain only a pseudonymous SHA-256 network identifier, never a
  raw address or bearer credential.

### Changed

- The 0.1.4 Helm chart pins the published verifier image by its immutable
  digest and continues to reject mutable images in `prod-ha-0.2`.
- The chart now requires an operator-supplied ingress allowlist for
  `prod-ha-0.2` and for every nonzero trusted-proxy hop count, making the
  forwarded-address trust boundary explicit and testable.
- There is no state-namespace change from 0.1.3 to 0.1.4. Deployments upgrading
  from 0.1.2 or earlier must still complete the mandatory 0.1.3 maintenance
  cutover and 15-minute drain.

## 0.1.3 - 2026-07-27

### Security

- Bound retained requirements, result consumption, and mutation acceptance to
  the authenticated issuer tenant. Tenant namespaces include both issuer and
  subject, and stored state keys receive only one-way scoped identifiers.
- Made authenticated non-development routers fail closed unless a custom
  requirement backend implements the explicit
  `TenantIsolatedRequirementStore` contract. Generic ownerless stores remain a
  local-development compatibility surface only.
- Hardened static bearer authentication with strict principal validation,
  digest-only token indexing, uniform failures, authentication/state rate
  limits, and a 15-minute maximum lifetime for caller-supplied result state.
- Added an atomic old-key check to the maintained in-memory, Redis, and
  PostgreSQL result stores as defense in depth during the namespace cutover.
  Authenticated routers reject base-only custom result stores; the required
  maintenance drain still applies.
- Forced protected Fetch, Express, and Next.js responses to remain private and
  non-cacheable, including successful downstream application and x402
  responses. Express header mutation cannot remove the protection boundary.

### Fixed

- Split browser-safe client code from Node-only modules and added a packed
  browser-bundle smoke test that rejects Node built-ins and exercises the
  complete `424 → proof → 201` exchange.
- Sent both World staging and production verification to the canonical
  `https://developer.world.org/api/v4/verify/{rp_id}` endpoint while preserving
  exact IDKit result forwarding.
- Corrected the OpenAPI requirement-state `DELETE` contract: an absent or
  tenant-inaccessible dependency is `404`, not a successful idempotent delete.
- Added strict Helm values/schema validation, one-process deployment guards,
  disruption and egress policy templates, Kubernetes schema checks, and a
  non-root container smoke test.
- Added an exact trusted-proxy hop setting for IP-based abuse controls and
  made the chart reject `prod-ha-0.2` unless DNS, World, and Redis egress CIDR
  allowlists and an immutable image digest are all explicit.

### Changed

- Low-level Fetch integrations that call `protectFetch()` or
  `protectFetchResource()` directly must apply the returned
  `responseHeaders` with `finalizeFetchX424Response()` to every downstream
  response. `createFetchX424Handler()` performs this finalization
  automatically.
- The 0.1.3 Helm chart pins the published verifier image by its immutable
  digest and no longer points at the previous 0.1.2 image.
- `RedisX424Store` now requires an explicit `single-endpoint` topology. Redis
  Cluster is unsupported during the legacy/new-key atomic migration because
  pre-0.1.3 keys do not share a hash slot.

### Upgrade action

- This release changes ownerless state keys to tenant-scoped keys. Stop all
  old verifier and protected-resource traffic, wait at least 15 minutes, and
  only then deploy 0.1.3. Follow
  [`docs/runbooks/state-namespace-0.1.3.md`](docs/runbooks/state-namespace-0.1.3.md);
  rolling upgrades and immediate rollback are unsafe during this transition.

## 0.1.2 - 2026-07-22

### Fixed

- Updated the release runner to Node.js 24 and npm 11.16 so the npm trusted
  publisher can exchange GitHub OIDC credentials and publish provenance-backed
  packages.

## 0.1.1 - 2026-07-22

### Security

- Migrated the MCP server to the split v2 SDK and a bounded Web Standard HTTP
  adapter, removing the vulnerable Hono server dependency while preserving
  stdio and stateless HTTP transports. The release gate now exercises MCP HTTP
  initialization and rejects untrusted Host headers.

## 0.1.0 - 2026-07-21

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
