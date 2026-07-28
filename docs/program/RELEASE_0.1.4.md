# x424 0.1.4 release evidence

> Published 2026-07-28 · unaudited developer preview

This record identifies the public artifacts produced from the SSH-signed
`v0.1.4` source tag. It records verifier-metadata rate limiting, private
response boundaries, production bearer-credential validation, and explicit
trusted-proxy ingress controls. It does not satisfy or waive the external wire
review, managed sandbox, real-device World, production assessment, high
availability, or independent-adoption gates.

## Source and workflows

- SSH-signed source tag and developer-preview prerelease:
  [`v0.1.4`](https://github.com/x424protocol/x424/releases/tag/v0.1.4)
- Source and merge commit: `9be1d774f26a69a49ff433fcb59a602c43ea89f0`
- Reviewed merge:
  [pull request 53](https://github.com/x424protocol/x424/pull/53)
- Required CI on the merged commit:
  [GitHub Actions run 30325488680](https://github.com/x424protocol/x424/actions/runs/30325488680)
- CodeQL on the merged commit:
  [GitHub Actions run 30325488682](https://github.com/x424protocol/x424/actions/runs/30325488682)
- Release workflow:
  [GitHub Actions run 30325526171](https://github.com/x424protocol/x424/actions/runs/30325526171)

The repository-bound npm trusted publisher is restricted to
`x424protocol/x424` and `.github/workflows/release.yml`. The release workflow
used Node 24 and npm 11.16.0; both the npm and verifier-image jobs completed
successfully. No long-lived npm automation token was used.

The tag object contains an SSH signature. GitHub reports `unknown_key` because
the signing public key is not registered as a GitHub signing key, so this
record does not claim GitHub-verified tag status.

## Package artifact

- Registry: [`x424@0.1.4`](https://www.npmjs.com/package/x424/v/0.1.4)
- Registry tarball:
  [`x424-0.1.4.tgz`](https://registry.npmjs.org/x424/-/x424-0.1.4.tgz)
- Registry integrity:
  `sha512-s49lFhZvCAtwBwvVW2rAIOO+KEKmav6zrgDbXZHZRtkqiaS1AkrJZqj1WVhkLkRvxgMwHEEd0oC6Syt4dU5iUA==`
- npm provenance:
  [`x424@0.1.4` attestations](https://registry.npmjs.org/-/npm/v1/attestations/x424@0.1.4)
- Attached copy:
  [`x424-0.1.4.tgz`](https://github.com/x424protocol/x424/releases/download/v0.1.4/x424-0.1.4.tgz)
- Checksum file:
  [`SHA256SUMS`](https://github.com/x424protocol/x424/releases/download/v0.1.4/SHA256SUMS)
- SHA-256:
  `1e7e4c10b079c965031cbc9d7b5f3d40c703dbe3419c98f644590512496edadf`
- Size: 248,758 bytes

The attached tarball is the exact npm registry artifact and is byte-identical
to `npm pack` from the tagged source. A clean consumer imported the maintained
core, browser client, World client, framework, managed-verifier, x402, Redis,
and MCP surfaces. `npm audit signatures` verified the installed registry
signatures and attestations, and the shipped dependency audit reported zero
known vulnerabilities.

```bash
npm install x424@0.1.4
```

## Verifier image

- Tag: `ghcr.io/x424protocol/x424-verifier:0.1.4`
- Digest:
  `sha256:471dd506115fb740e61e0f1263161ba91f171c706e7b4071c9e606feb1cb8061`
- Runtime user: `10001`
- Visibility: public
- Attached SPDX SBOM:
  [`x424-verifier-v0.1.4.spdx.json`](https://github.com/x424protocol/x424/releases/download/v0.1.4/x424-verifier-v0.1.4.spdx.json)
- SBOM SHA-256:
  `6359e5c5a45e2dae7542f4c97d05512fbc292a1bfc7b0dcddc86f2d2c2104950`

The release workflow attached registry provenance and SBOM attestations and
signed the digest with Cosign using GitHub OIDC. Independent post-publication
checks verified both GitHub attestations against the exact repository,
workflow, source ref, and source digest. Cosign 3.0.6 verified the exact
workflow certificate identity and transparency-log inclusion.

Pull by digest for immutable evaluation:

```bash
docker pull ghcr.io/x424protocol/x424-verifier@sha256:471dd506115fb740e61e0f1263161ba91f171c706e7b4071c9e606feb1cb8061
```

The repository Helm values pin this exact digest. Operators upgrading from
0.1.2 or earlier must still follow the
[tenant-state namespace cutover runbook](../runbooks/state-namespace-0.1.3.md).
There is no state-namespace change from 0.1.3 to 0.1.4.

## Verification summary

- 25 test files and 115 tests passed on the tagged source;
- type checking, build, browser-bundle smoke, MCP HTTP initialization, and
  forged-Host rejection passed;
- the browser smoke rejected Node built-ins and completed the synthetic
  `424 → proof → 201` exchange;
- Helm 3/4 lint, strict values validation, Kubernetes 1.25/1.31 schema checks,
  restricted production ingress and egress, immutable-image, trusted-proxy,
  and single-replica guards passed;
- the non-root image booted with Redis and passed the production credential
  gate, metadata authentication/throttling, tenant state, legacy migration,
  same-operation acceptance, and replay rejection;
- pull-request and merged-commit CodeQL analyses passed, and the repository
  reported zero open code-scanning, dependency, and secret-scanning alerts;
- the packed-package consumer and website production-dependency audit reported
  zero known vulnerabilities; and
- the release workflow published npm provenance, image provenance, an SPDX
  SBOM attestation, and a keyless Cosign signature.

## Maturity boundary

This is publication and first-party automated evidence, not an independent
security or privacy assessment. The World profile still lacks a published
real-device staging matrix, the brokered World session remains process-local,
the chart remains a one-replica evaluation surface, Redis Cluster is
unsupported for the 0.1.3 migration, and no unrelated production adopter or
independent verifier has been demonstrated.
