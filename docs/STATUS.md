# Current status

> x424/0.1 developer preview · unaudited · not a production security
> certification or accepted global standard

Snapshot: 2026-07-20. This page summarizes public evidence; the authoritative
release gates remain in the [roadmap](ROADMAP.md) and
[deliverable register](program/DELIVERABLE_REGISTER.md).

## What exists now

| Surface                     | State                                | Evidence                                                          |
| --------------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| HTTP wire contract          | Implemented and locally tested       | Protocol, schemas, OpenAPI, conformance vectors                   |
| TypeScript SDK              | Implemented and locally tested       | 20 test files / 83 tests; package build and pack smoke            |
| World profile               | Synthetic positive/negative coverage | v4 default, legacy opt-in, provider-request vectors               |
| Framework adapters          | Implemented and locally tested       | Fetch, Express, and Next.js parity tests                          |
| Self-hosted verifier        | Runnable evaluation profile          | Non-root image source, Compose, Redis, Helm templates             |
| Managed-verifier interfaces | Implemented and locally tested       | Authenticated issuance, metadata, requirement and replay clients  |
| x424 before x402            | Implemented and locally tested       | Ordered middleware/client helpers and official x402-package tests |
| Developer quickstart        | Automated in CI                      | One command exercises challenge, proof, retry, and 201 result     |

“Implemented and locally tested” does not mean independently audited,
production-operated, or interoperable across independent implementations.

## What has not been proven

- no independent security or privacy assessment is complete;
- no public managed verifier or self-service console is live;
- no real World staging browser/mobile matrix is published;
- no production load, failover, backup/restore, or key-compromise exercise is
  published;
- no independently authored Go implementation has passed mixed-stack flows;
- no second materially different provider profile is accepted;
- no independent verifier-operator swap is demonstrated;
- no two unrelated production adopters are documented; and
- no neutral standards body has accepted x424.

## Safe claim language

Use these descriptions until later gates pass:

- “open x424/0.1 developer preview”;
- “HTTP-native unique-human dependency protocol”;
- “World-first TypeScript reference implementation”; and
- “production-candidate surfaces under evaluation.”

Do not describe x424 as audited, production-certified, provider-equivalent, a
universal human ID, an IETF standard, or an accepted global standard.

## Next release gates

1. Publish a provenance-backed npm release and reproducibility record.
2. Run the ten-minute flow with unfamiliar developers using only public docs.
3. Publish real World staging browser, mobile-web, REST, and agent-key evidence.
4. Complete external wire-contract, security, and privacy review.
5. Publish signed verifier artifacts, SBOMs, and operational exercise results.

Gate completion requires immutable evidence links. Code or documentation alone
cannot satisfy an external review, live operation, or independent adoption
requirement.
