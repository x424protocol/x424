# Roadmap to an interoperable standard

> Status snapshot: 2026-07-20

x424 makes unique humanity a native HTTP dependency—for users, agents, and
APIs. The protocol earns adoption and standards credibility through public
artifacts, independently operated implementations, and production evidence—not
by declaring itself a standard.

Execution is tracked in the public [GitHub milestones and issues](https://github.com/x424protocol/x424/milestones).
Closing an issue records evidence; it does not waive the gate described here.

## Success measures

x424 is successful when:

- a new developer protects a sandbox endpoint in ten minutes;
- a production-shaped integration takes no more than one working day;
- adopters write no proof parsing, nullifier, token, or replay-control code;
- managed and self-hosted verifiers use the same public resource contract;
- independent TypeScript and Go implementations interoperate;
- at least two materially different providers preserve their exact claims;
- an independent verifier and two unrelated adopters use public surfaces only;
- external security and privacy review finds no unresolved Critical or
  unaccepted High issue; and
- neutral governance ratifies the stable profile only after that evidence
  exists.

## 0.1 — Installable developer preview

Purpose: freeze a testable first contract and make the World-first flow usable
without custom protocol code.

- [x] Normative HTTP requirement and result contract
- [x] JSON Schemas, OpenAPI, and positive/negative vectors
- [x] Provider adapter SDK and fail-closed method catalog
- [x] World Proof of Human profile with explicit v4/legacy semantics
- [x] Browser, REST, agent, Express, and Fetch reference surfaces
- [x] Redis and PostgreSQL atomic state implementations
- [x] Canonical public articulation across every project surface
- [x] Local self-hosted Redis/World quickstart source
- [ ] Managed sandbox deployment and public credentials
- [x] Provenance release workflow and packed-package smoke tests
- [ ] Authorized npm publication, signed tag, and reproducibility record
- [ ] External review of the wire contract and threat model
- [ ] Ten-minute sandbox validation with an unfamiliar developer

Exit: a developer can install a tagged package, run both quickstarts, identify
every non-production component, and satisfy the public adopter contract.

## 0.2 — Production candidate

Purpose: make both self-hosted and managed verification operationally safe.

- [x] Runnable non-root verifier image and Helm templates
- [ ] Signed image, SBOM, and published artifact evidence
- [x] Authenticated least-privilege issuance and verifier metadata
- [x] Non-exportable signing and pairwise-derivation key interfaces
- Tested key rotation, retirement, revocation, and compromise recovery
- Redis/PostgreSQL failover, backup, restore, and concurrency profiles
- [x] Maintained Fetch, Express, and Next.js resource middleware
- [x] Managed verifier client and remote atomic-store adapters
- [x] Proof-safe errors, shared rate limits, egress controls, and runbooks
- World staging, browser, mobile-web, REST, and agent-key matrices
- Fuzz, dependency, load, chaos, security, and privacy assessment
- [x] Deterministic x424-before-x402 server and client composition

Exit: a reviewed deployment protects production access, meets the named 99.9%
profile, has no unresolved Critical or unaccepted High finding, and can be
integrated from public documentation in one working day.

## 0.3 — Interoperability candidate

Purpose: prove x424 is a protocol rather than one TypeScript package.

- Black-box conformance suites for clients, resources, verifiers, stores, and
  provider adapters
- Independently authored Go implementation and mixed-stack flows
- Second provider with a materially different root of trust and lifecycle
- Independently operated verifier with operator-swap evidence
- Two unrelated production adopters using public surfaces only
- Public compatibility matrix covering providers, implementations, deployment
  modes, browsers, agents, and x402 composition

Exit: independently operated components interoperate without private guidance
or a privileged implementation path.

## 1.0 — Stable protocol

Purpose: freeze the smallest contract the ecosystem has already proven.

- Formal canonicalization, transport, signature, replay, and downgrade profile
- Stable provider namespace, compatibility, migration, and deprecation policy
- Permanent conformance bundles and public interoperability results
- Security/privacy delta review against the frozen specification
- Independent protocol, provider, verifier, and adopter representation
- Recorded decision on an appropriate neutral standards venue

The stable gates in [GOVERNANCE.md](GOVERNANCE.md) remain authoritative.

## Claims discipline

Until the corresponding gates pass, describe x424 as an open developer preview,
production candidate, or interoperability candidate. Do not call it an IETF
standard, universal human identifier, provider-equivalence layer, or production
security certification.

Gate evidence is tracked under [program/](program/). Code, documentation, or
local tests alone cannot satisfy an external-review or independent-adoption
gate.
