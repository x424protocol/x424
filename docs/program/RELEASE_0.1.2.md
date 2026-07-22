# x424 0.1.2 release evidence

> Published 2026-07-22 · unaudited developer preview

This record identifies the public artifacts produced from the signed `v0.1.2`
source tag. It completes the installable-package publication gate. It does not
satisfy or waive the external wire review, managed sandbox, real-device World,
production assessment, or independent-adoption gates.

## Source and workflow

- Signed source tag and prerelease:
  [`v0.1.2`](https://github.com/x424protocol/x424/releases/tag/v0.1.2)
- Source commit: `007fe7015d9fa65154660f025dfd713bb18035ff`
- Release workflow:
  [GitHub Actions run 29957724813](https://github.com/x424protocol/x424/actions/runs/29957724813)

The repository-bound npm trusted publisher is restricted to
`x424protocol/x424` and `.github/workflows/release.yml`. The workflow used Node
24 and npm 11.16.0; both the npm publication and verifier-image jobs completed
successfully. No long-lived npm automation token was used.

## Package artifact

- Registry: [`x424@0.1.2`](https://www.npmjs.com/package/x424/v/0.1.2)
- Registry integrity:
  `sha512-hhJKWMT76MsL5UJvowy+8LJnAQO4RDybmCQc6nWlaA9u4IhKcApltbg4IdaHOm/vTphminz+slbSDrtnqDjeMg==`
- Attached artifact:
  [`x424-0.1.2.tgz`](https://github.com/x424protocol/x424/releases/download/v0.1.2/x424-0.1.2.tgz)
- SHA-256:
  `cb9514cc02e216767ff39ebff275ee7651b53710f1a0cddfe91ebae1cccd6574`
- Size: 222,319 bytes

The attached tarball is the exact npm registry artifact. A clean Node 24
consumer installed it, imported `x424`, `x424/core`, `x424/client`,
`x424/world`, and `x424/mcp`, and reported zero npm vulnerabilities.

```bash
npm install x424@0.1.2
```

## Verifier image

- Tag: `ghcr.io/x424protocol/x424-verifier:0.1.2`
- Digest:
  `sha256:9d4cb308e03c51357d45c3604d111be5cb9ba309c017321be8a4cc08af0a9b1a`
- Platform: `linux/amd64`
- Runtime user: `10001`
- Visibility: public

The workflow attached SPDX SBOM and provenance attestations and signed the
digest with Cosign using GitHub OIDC. Pull by digest for immutable evaluation:

```bash
docker pull ghcr.io/x424protocol/x424-verifier@sha256:9d4cb308e03c51357d45c3604d111be5cb9ba309c017321be8a4cc08af0a9b1a
```

## Verification summary

- 24 test files and 100 tests passed;
- positive and negative conformance vectors passed;
- packed-package installation and all public-export imports passed;
- the non-root image booted with Redis and passed health, requirement issuance,
  same-operation acceptance, and replay-rejection checks;
- the hardened MCP HTTP server passed initialize and forged-Host rejection;
- the production npm dependency audit reported zero known vulnerabilities; and
- the release workflow published npm provenance, image provenance, an SPDX SBOM,
  and a keyless Cosign signature.
