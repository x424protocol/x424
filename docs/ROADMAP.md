# Roadmap to an interoperable standard

> Status snapshot: 2026-07-19

x424 aims to make a unique-human dependency a configuration choice for HTTP
resources, clients, and agents. The protocol earns that position through
independent implementations and adoption, not by declaring itself a standard.

## Success measures

x424 is on the standards path when:

- an unrelated team can protect an endpoint with a supported provider in one
  working day without protocol or cryptographic code;
- an independently built client can satisfy an independently operated resource
  server and verifier;
- at least two providers with different trust models preserve their exact
  claims through the same wire contract;
- at least one non-TypeScript implementation passes every published vector;
- two unrelated production adopters use only public protocol surfaces; and
- external security and privacy review finds no unresolved critical issue.

## Release stages

### 0.1 — Developer preview

Purpose: freeze a testable first contract and remove basic adopter glue.

- [x] Normative HTTP requirement and result contract
- [x] JSON Schemas, OpenAPI, and fixed positive/negative vectors
- [x] Provider adapter SDK and fail-closed method catalog
- [x] Strict World Proof of Human profile with built-in signal binding
- [x] Generic HTTP verifier resolver and one-retry client
- [x] Injectable requirement storage and Redis atomic state implementation
- [ ] Reproducible npm release with provenance and package smoke tests
- [ ] Complete end-to-end World browser example using only public APIs
- [ ] External review of the 0.1 wire and threat model

Exit: an external developer can run the complete local flow from the README and
identify every non-production component.

### 0.2 — Production candidate

Purpose: make self-hosting operationally complete.

- Deployable verifier image with authenticated issuance
- Maintained Express and generic Fetch resource middleware
- KMS/HSM signer interface and authenticated verifier-key metadata
- Signing-key and pairwise-secret rotation with overlap tests
- Redis and PostgreSQL deployment profiles with failure-injection tests
- Proof-safe metrics, structured errors, rate limits, and abuse controls
- Fuzzing, dependency review, load tests, and independent security/privacy
  assessment
- Recovery and provider-outage runbooks

Exit: a reviewed deployment can protect production access without replacing a
reference component with undocumented application code.

### 0.3 — Interoperability candidate

Purpose: prove that x424 is a protocol rather than one package.

- Second provider profile with a materially different trust model
- Independent implementation in another language
- Public cross-implementation compatibility matrix
- Two unrelated relying-party deployments
- Maintained browser, agent, and server integration suites
- Verifier discovery, authenticated metadata, and revocation semantics
- At least one independent managed verifier or facilitator

Exit: separately operated components interoperate from the public artifacts
alone.

### 1.0 — Stable protocol

Purpose: freeze the smallest contract the ecosystem has already proven.

- Formal canonicalization profile
- Stable extension and provider-namespace process
- Public security and privacy findings resolved
- Complete compatibility and migration policy
- Appropriate neutral standards venue evaluated with adopters and providers

The stable gates in [GOVERNANCE.md](GOVERNANCE.md) remain authoritative.

## Workstream priorities

1. **Adopter experience:** reduce integration to provider configuration,
   binding, UI, and application policy.
2. **Security:** ship production state, key custody, rotation, and failure
   behavior before broad promotion.
3. **Interoperability:** fund an independent implementation and publish every
   mismatch as a conformance issue.
4. **Provider ecosystem:** add profiles slowly; exact semantics matter more
   than adapter count.
5. **Distribution:** publish examples with unrelated adopters and integrate
   cleanly before x402 where both dependencies apply.

## Claims discipline

Until 1.0, describe x424 as an open pre-alpha protocol or interoperability
candidate. Do not call it an IETF standard, a universal human identifier, a
provider-equivalence layer, or a production security certification.
