# Current-state baseline evidence

Baseline date: 2026-07-20
Working-tree parent commit: `c496c5a32c477524f7047e8703d387a498fdec64`
Branch: `codex/standards-readiness`
Package: `x424@0.1.0`

This file is the living P0-02 evidence surface. A changed baseline is not
evidence that a later phase gate has passed. Exact CI run URLs are recorded only
after a real CI execution for the reviewed commit/tree.

## Inventory (working tree)

| Area              | Evidence                                                          |
| ----------------- | ----------------------------------------------------------------- |
| Schemas           | four JSON Schemas under `schemas/` (incl. human-required problem) |
| OpenAPI           | `openapi/x424.openapi.json`                                       |
| Vectors           | `conformance/v0.1/vectors.json` + local security regression tests |
| Tests             | 16 files under `test/` (count grows with security suite)          |
| Provider profiles | World `proof-of-human@1`, `orb-legacy@1` (legacy off by default)  |
| State             | In-memory, Redis, Postgres profiles                               |
| Middleware        | Express + Fetch with current-request binding checks               |
| Auth              | Deny-by-default issuance; explicit deployment profiles            |
| Transport         | header ≤8 KiB; body transport above envelope                      |
| Site              | `site/` — requires Node ≥22 for vinext build                      |

## Maturity table

Unchanged in substance from the prior baseline: developer preview / unaudited
pre-alpha. Production profiles exist as code and docs, not as independently
assessed deployments.

## Metrics

Time-to-first-endpoint, bundle impact, and named-profile latency remain
unmeasured with fresh engineers. Methods are documented; values are not claimed.
