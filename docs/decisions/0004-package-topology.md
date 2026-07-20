# ADR-0004: Package topology for 0.1/0.2

- Status: accepted
- Date: 2026-07-19
- Decision makers: Reference lead (program baseline)
- Requirement IDs: distribution / DX (ROADMAP 0.1)

## Context

Browser consumers must not resolve Redis, Express, MCP, or Node-only code.
Monorelease is convenient but risky for tree-shaking and install surface.

## Alternatives

1. Split immediately into `@x424/core`, `@x424/client`, `@x424/verifier`, etc.
2. Keep a single package with no export boundaries.
3. **Selected:** Keep a single `x424` package for 0.1 with strict subpath
   exports; document which subpaths are portable vs Node-only; add pack/bundle
   smoke tests. Split before 0.2 if portable surfaces cannot exclude server deps.

## Decision

| Subpath                           | Runtime                  | Notes                               |
| --------------------------------- | ------------------------ | ----------------------------------- |
| `x424/core`                       | portable + Node          | No Express/MCP; may use Node crypto |
| `x424/client`                     | portable                 | Fetch-based                         |
| `x424/adapters`, `providers/*`    | Node/browser per adapter | World client is browser-safe        |
| `x424/express`, `x424/middleware` | Node                     | Express peer                        |
| `x424/redis`, `x424/postgres`     | Node                     | Injected clients                    |
| `x424/mcp`                        | Node                     | Optional tooling                    |

`package.json` `sideEffects: false`. Server-only entrypoints must not be
imported from browser bundles. Provenance publish remains the release path;
this ADR does not authorize an npm publish.

## Security impact

Reduces accidental inclusion of verifier secrets tooling in browsers.

## Compatibility

Subpath exports are semver surfaces. Removing a subpath is breaking.
