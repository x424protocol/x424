# Current-state baseline evidence

Baseline date: 2026-07-20
Working-tree parent commit: `50fa0ce8f95e1ce60b825d8eb386445bd3b2d6f9`
Branch: `codex/public-adoption-hygiene`
Package: `x424@0.1.0`

This file is the living P0-02 evidence surface. A changed baseline is not
evidence that a later phase gate has passed. Exact CI run URLs are recorded only
after a real CI execution for the reviewed commit/tree.

## Inventory (working tree)

| Area              | Evidence                                                           |
| ----------------- | ------------------------------------------------------------------ |
| Schemas           | four JSON Schemas under `schemas/` (incl. human-required problem)  |
| OpenAPI           | `openapi/x424.openapi.json`                                        |
| Vectors           | wire vectors plus World provider-request negative bundle           |
| Tests             | 20 files / 83 tests at this baseline                               |
| Provider profiles | World `proof-of-human@1`, `orb-legacy@1` (legacy off by default)   |
| State             | In-memory, Redis, Postgres profiles                                |
| Middleware        | Express + Fetch + Next.js, managed state, ordered x402 composition |
| Auth              | Deny-by-default issuance; explicit deployment profiles             |
| Transport         | header ≤8 KiB; body transport above envelope                       |
| Deployment        | runnable Redis image source, Compose profile, Helm chart           |
| Site              | `site/` — Node ≥22 vinext build verified locally                   |
| Quickstart        | one-command synthetic challenge/proof/retry flow, enforced in CI   |

## Maturity table

x424/0.1 developer preview / unaudited. Production-candidate surfaces exist as
code and docs, not as independently assessed deployments. The public
[`STATUS.md`](../STATUS.md) matrix separates implemented, tested, and missing
external evidence.

## Metrics

Time-to-first-endpoint, bundle impact, and named-profile latency remain
unmeasured with fresh engineers. Methods are documented; values are not claimed.
