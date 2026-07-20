# Master deliverable register (evidence)

Updated: 2026-07-19  
Authority: Appendix B of EXECUTION_PLAN.md

Status values: `complete` | `partial` | `externally_blocked` | `not_started` | `in_progress`

| ID             | Status             | Evidence                                                       | External blocker                              | Notes                                |
| -------------- | ------------------ | -------------------------------------------------------------- | --------------------------------------------- | ------------------------------------ |
| P0-01          | partial            | docs/program/_, docs/decisions/_                               | GitHub epic board / named people require auth | Repo baseline artifacts present      |
| P0-02          | complete           | docs/program/BASELINE_EVIDENCE.md, THREAT_DATA_FLOW.md         | —                                             | Living baseline; update after merges |
| P0-03          | complete           | SEVERITY_POLICY.md, DEPLOYMENT_PROFILES.md, REQUIREMENT_IDS.md | External reviewer sign-off pending            | Profiles numeric                     |
| P0-04          | complete           | CONFLICT_GOVERNANCE.md                                         | —                                             | Recusal + two-party + appeal         |
| P0-05          | partial            | EXTERNAL_ENGAGEMENTS.md                                        | Funded/named counterparties                   | Packages ready; not contracted       |
| P1-01          | partial            | ADR-0001, src/transport.ts, test/transport.test.ts             | Full intermediary lab matrix                  | Envelope + CORS + redirect rules     |
| P1-02          | partial            | ADR-0002, canonical body digests, middleware idempotency       | —                                             | Streams fail closed                  |
| P1-03          | partial            | ADR-0003, X424_CANON_PROFILE                                   | Independent implementer differential          | Candidate frozen in-repo             |
| P1-04          | partial            | examples/world-browser/*                                       | Real browser/IDKit matrix                     | Fake adapter local stack             |
| P1-05          | partial            | ADR-0004, exports, pack:smoke script, release.yml              | npm provenance publish unauthorized           | Topology decided; tag not published  |
| P1-06          | externally_blocked | EXTERNAL_ENGAGEMENTS E1                                        | Design review engagement                      | Must not fabricate                   |
| P2-01          | partial            | deploy/verifier/*                                              | Signed image/SBOM in release                  | Image + probes + compose             |
| P2-02          | partial            | src/auth/issuance.ts, src/metadata/*, router hooks, tests      | —                                             | Authz + signed metadata              |
| P2-03          | partial            | src/keys/managed.ts, signHumanResultWithExternal, runbook      | Real KMS drill                                | Interface + local signer             |
| P2-04          | partial            | PostgresX424Store, Redis existing, tests                       | Multi-region/failover lab                     | PG transactional profile             |
| P2-05          | partial            | src/middleware/resource.ts, test/middleware.test.ts            | —                                             | Express + Fetch                      |
| P2-06          | partial            | ops/limits, redaction, runbooks                                | DPIA external                                 | Limits + redaction                   |
| P2-07          | partial            | test coverage expanded; no load lab yet                        | Fuzz/load/chaos + audit                       | Property tests pending scale         |
| P2-08          | externally_blocked | —                                                              | Independent gate panel + tag                  | Do not claim 0.2 RC                  |
| P3-01..P3-04   | not_started        | —                                                              | Requires P2-08                                | Problee untouched by design          |
| P4A-01         | partial            | EXTERNAL_ENGAGEMENTS E3                                        | Implementer contract                          | Mobilization package                 |
| P4A-02         | partial            | EXTERNAL_ENGAGEMENTS E4–E6                                     | Counterparties                                | Criteria only                        |
| P4B-01         | partial            | src/conformance/cli.ts, pnpm conformance                       | Signed suite coverage map                     | Scaffold runner                      |
| P4B-02..P4B-06 | externally_blocked | —                                                              | Independent impl/provider/adopters            | Artifacts only                       |
| P5-*           | not_started        | —                                                              | Prior gates                                   | —                                    |
| P6-*           | not_started        | —                                                              | After 1.0                                     | —                                    |
