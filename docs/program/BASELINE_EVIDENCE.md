# Current-state baseline evidence

Baseline date: 2026-07-19  
Repository commit at plan authoring: `84280015e428b964301f5561c8ad6373f95e32bf`  
Branch: `codex/standards-readiness`  
Package: `x424@0.1.0`  
Node engine: `>=22` (CI); local measurement Node may differ.

This file is the living P0-02 evidence surface. Update after material merges.
A changed baseline is not evidence that a later phase gate has passed.

## Inventory

| Area                | Evidence                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Schemas             | `schemas/human-requirement-0.1.schema.json`, `human-proof-submission-0.1.schema.json`, `human-result-0.1.schema.json` |
| OpenAPI             | `openapi/x424.openapi.json`                                                                                           |
| Vectors             | `conformance/v0.1/vectors.json` (fixed requirement/result + negative mutations)                                       |
| Tests (at baseline) | 9 files under `test/`, 31 tests passing via `pnpm test`                                                               |
| Provider profiles   | World `proof-of-human@1`, `orb-legacy@1` (legacy off by default)                                                      |
| State               | In-memory stores; `RedisX424Store`                                                                                    |
| Verifier API        | Express router (`x424/express`) — demonstrative                                                                       |
| Client              | `fetchWithX424`, `createHttpHumanDependencyResolver`                                                                  |
| Site                | `site/` Next landing; CI HTML smoke + audit                                                                           |
| Release workflow    | `.github/workflows/release.yml` provenance publish — **unproven** (no tag)                                            |

## Maturity table

| Area             | Maturity                 | Principal gap                                   |
| ---------------- | ------------------------ | ----------------------------------------------- |
| Package          | developer preview        | first npm provenance tag unproven               |
| Protocol         | pre-alpha                | transport/body/canon need external review       |
| Tests            | reference                | no black-box role suite, fuzz, load, chaos      |
| Provider         | provider preview         | complete public browser E2E; second trust model |
| State            | partial production shape | PostgreSQL; multi-region; failure injection     |
| Verifier API     | demonstrative            | authz, image, rate limits, abuse controls       |
| Keys/trust       | cryptographic reference  | KMS, metadata, rotation, revocation             |
| Client           | developer preview        | non-JSON body, redirect, CORS matrix            |
| Distribution     | implemented, unproven    | published release, SBOM, signed image           |
| Adoption         | planned                  | Problee observation and public-surface use      |
| Interoperability | not independently proven | non-TS impl, independent verifier, 2nd provider |
| Security/privacy | unaudited pre-alpha      | external assessment, DPIA, drills               |

## Public APIs lacking compatibility tests (baseline)

- Packed-artifact export smoke (workflow exists; not run from tag)
- Browser/edge bundle exclusion of Redis/Express/MCP/Node-only paths
- CORS / redirect / intermediary header-limit matrix
- Non-JSON and streaming body digest profiles
- Resource-server Express/Fetch middleware (absent at baseline)
- Authenticated issuance and metadata discovery (absent at baseline)
- Key rotation / revocation verify paths (absent at baseline)

## Baseline metrics method

| Metric                          | Method                                          | Baseline value                       |
| ------------------------------- | ----------------------------------------------- | ------------------------------------ |
| Time to protect one endpoint    | Fresh engineer using only public docs           | Not yet measured (DX study pending)  |
| Package install time            | empty project `pnpm add` from packed tarball    | Not yet measured                     |
| Client bundle impact            | bundler analysis of `x424/client` + `x424/core` | Not yet measured                     |
| Verifier latency excl. ceremony | local fixture create+verify                     | Not yet measured under named profile |

## CI

Workflow: `.github/workflows/ci.yml` runs `pnpm check`, pack dry-run, site test/audit.
Exact CI run URL for a given commit must be linked when marking gate evidence.
