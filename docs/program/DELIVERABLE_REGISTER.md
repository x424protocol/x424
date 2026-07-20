# Master deliverable register (evidence)

Updated: 2026-07-20
Authority: Appendix B of EXECUTION_PLAN.md

Status values: `complete` | `partial` | `externally_blocked` | `not_started` | `in_progress`

Rules: a document existing is not gate approval. Local tests are not external
evidence. Never invent reviewer names, URLs, signatures, or approvals.

| ID           | Status             | Evidence                                                       | External blocker                      | Notes                                  |
| ------------ | ------------------ | -------------------------------------------------------------- | ------------------------------------- | -------------------------------------- |
| P0-01        | partial            | docs/program/_, docs/decisions/_                               | GitHub epic board / named people      | Repo artifacts only                    |
| P0-02        | partial            | docs/program/BASELINE_EVIDENCE.md                              | Exact CI run URL after merge          | Inventory updated; CI evidence pending |
| P0-03        | partial            | SEVERITY_POLICY.md, DEPLOYMENT_PROFILES.md, REQUIREMENT_IDS.md | External security reviewer sign-off   | Local drafts only                      |
| P0-04        | partial            | CONFLICT_GOVERNANCE.md                                         | Independent protocol review evidence  | Process text only                      |
| P0-05        | partial            | EXTERNAL_ENGAGEMENTS.md                                        | Funded/named counterparties           | Packages ready; not contracted         |
| P1-01        | partial            | ADR-0001 (review-pending), transport impl + tests              | Intermediary lab + independent review | Body transport implemented             |
| P1-02        | partial            | ADR-0002 (review-pending), body digests + tests                | —                                     | Explicit body kinds                    |
| P1-03        | partial            | ADR-0003 (review-pending), strict encoding                     | Independent implementer               | Candidate not ratified                 |
| P1-04        | partial            | examples/world-browser/*                                       | Real browser/IDKit matrix             | Fake adapter local stack               |
| P1-05        | partial            | ADR-0004, pack:smoke                                           | npm provenance publish unauthorized   | —                                      |
| P1-06        | externally_blocked | EXTERNAL_ENGAGEMENTS E1                                        | Design review engagement              | Must not fabricate                     |
| P2-01        | partial            | deploy/verifier/*                                              | Signed image/SBOM release             | Skeleton                               |
| P2-02        | partial            | auth + metadata + router                                       | External security review              | Deny-by-default issuance               |
| P2-03        | partial            | keys/managed.ts                                                | Real KMS drill                        | Interface only                         |
| P2-04        | partial            | Postgres + Redis                                               | Failover lab                          | —                                      |
| P2-05        | partial            | middleware with current-request binding                        | —                                     | Substitution fixed                     |
| P2-06        | partial            | limits, redaction, privacy-safe errors                         | DPIA external                         | —                                      |
| P2-07        | partial            | security regression tests                                      | Load/chaos/audit                      | —                                      |
| P2-08        | externally_blocked | —                                                              | Independent gate panel                | Do not claim 0.2 RC                    |
| P3-01..P3-04 | not_started        | —                                                              | Requires P2-08                        | Problee untouched                      |
| P4A-01/02    | partial            | EXTERNAL_ENGAGEMENTS                                           | Counterparties                        | —                                      |
| P4B-01       | partial            | conformance CLI                                                | Signed suite coverage                 | —                                      |
| P4B-02..06   | externally_blocked | —                                                              | Independent parties                   | —                                      |
| P5/P6        | not_started        | —                                                              | Prior gates                           | —                                      |
