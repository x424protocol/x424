# Protocol governance

x424 is intended to be implementable without depending on one adopter,
provider, chain, verifier operator, or software package. Governance therefore
protects semantic portability rather than a preferred deployment.

## Authority of artifacts

For x424/0.1, artifacts have this order of authority:

1. the normative requirements in `PROTOCOL.md`;
2. the JSON Schemas for wire-object shape;
3. the fixed conformance vectors for canonical bytes and evaluation behavior;
4. the OpenAPI document for the optional reference verifier API; and
5. the TypeScript implementation and examples.

An inconsistency is a protocol defect. Implementations must not choose the
interpretation that accepts more proofs; unresolved ambiguity fails closed and
requires a versioned correction.

Program controls, severity policy, deployment profiles, and conflict rules live
under [program/](program/). Portable decisions use
[decisions/](decisions/). Adopter-driven changes follow
[program/CONFLICT_GOVERNANCE.md](program/CONFLICT_GOVERNANCE.md).

## Change process

- Protocol changes are proposed publicly with motivation, security impact,
  compatibility impact, and updated negative vectors.
- Breaking changes to wire objects, canonicalization, result signatures,
  bindings, replay, privacy, or acceptance semantics require a new x424
  protocol version.
- Provider descriptor changes require a new immutable descriptor version; an
  existing tuple is never reinterpreted.
- Reference implementation changes that do not alter the protocol still need
  tests proving they preserve the published vectors.
- Vulnerabilities follow the private disclosure process in the repository
  security policy before public discussion.

## Provider namespaces

A provider adapter is an implementation contribution, not protocol
endorsement. Inclusion never adds the method to any relying-party policy and
never establishes equivalence to another provider.

Provider and method identifiers use lowercase protocol identifier syntax.
Namespace proposals must document operator ownership, collision risk, exact
claim and non-claims, lifecycle, recovery, privacy, replay, binding, and
verification modes. Namespace assignment is not trademark or legal clearance.

## Neutrality

- No adopter receives protocol-only fields, privileged result semantics, or a
  reserved authorization path.
- No provider is a universal default.
- No canonical chain, token, registry, verifier service, or human identifier is
  required.
- Reference adapters and deployments must remain removable without changing
  core wire objects.
- Commercial services may implement x424, but conformance claims remain
  independently testable using public artifacts.
- First adopters use public interfaces only and receive no hidden compatibility
  path. See [ADOPTER_CONTRACT.md](ADOPTER_CONTRACT.md).

## Stable 1.0 gates

x424 should not declare a stable 1.0 profile until it has:

1. independent security and privacy review;
2. at least one independent implementation in another language;
3. at least two provider adapters with materially different trust models;
4. at least two unrelated relying-party deployments;
5. authenticated verifier metadata and signing-key rotation semantics;
6. a formally frozen canonicalization profile; and
7. public interoperability results covering every normative vector.

After these gates, the maintainers should evaluate an appropriate neutral
standards venue. Standards submission must preserve Apache-2.0 implementation
rights and avoid granting any adopter or provider control over conformance.
The staged execution plan is tracked in [ROADMAP.md](ROADMAP.md).
