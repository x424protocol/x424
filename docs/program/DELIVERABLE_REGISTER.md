# Public release-gate evidence

Updated: 2026-07-22

Status values: `complete` | `partial` | `externally_blocked` | `not_started`.
A document or local test is not independent evidence. Never invent reviewers,
approvals, deployments, adopters, or artifact URLs.

| Gate                     | Status             | Repository evidence                                        | Missing external evidence                                         |
| ------------------------ | ------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| 0.1 wire and schemas     | partial            | protocol, schemas, OpenAPI, vectors, security regressions  | independent design/threat review                                  |
| 0.1 package              | complete           | signed `v0.1.2`, npm provenance, tarball/checksum, image   | —                                                                 |
| 0.1 developer experience | partial            | automated one-command flow, World and HTTP examples        | managed sandbox and timed unfamiliar-developer run                |
| 0.2 self-hosted verifier | partial            | public signed image, SBOM/provenance, Helm, key interfaces | Docker/Helm runtime exercises and independent assessment          |
| 0.2 managed verifier     | partial            | public issuance/state/replay client and OpenAPI            | separate conforming service, console, tenant/security review      |
| 0.2 frameworks           | partial            | Express, Fetch, and Next.js parity tests                   | real World browser/mobile matrix                                  |
| 0.2 x402 composition     | partial            | helpers, official-client adapter, examples, ordering tests | live self-hosted/managed payment evidence                         |
| 0.2 operations/security  | externally_blocked | threat model, deployment profiles, runbooks                | load/chaos results and external security/privacy report           |
| 0.3 Go implementation    | externally_blocked | conformance vectors and CLI                                | independently authored implementation and mixed-stack results     |
| 0.3 second provider      | externally_blocked | adapter SDK and profile template                           | accepted materially different provider profile                    |
| 0.3 independent verifier | externally_blocked | public API and metadata profile                            | operator and swap evidence                                        |
| 0.3 unrelated adopters   | externally_blocked | adopter contract                                           | two public-surface production reports                             |
| 1.0 stable profile       | not_started        | governance and standards profile                           | prior gates, frozen profile, delta review, neutral venue decision |
