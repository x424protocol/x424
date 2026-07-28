# x424 0.1.3 release evidence

> Published 2026-07-28 · unaudited developer preview

This record identifies the public artifacts produced from the signed `v0.1.3`
source tag. It records the tenant-isolation, cache-boundary, browser-client, and
deployment hardening release. It does not satisfy or waive the external wire
review, managed sandbox, real-device World, production assessment, high
availability, or independent-adoption gates.

## Source and workflows

- Signed source tag and developer-preview prerelease:
  [`v0.1.3`](https://github.com/x424protocol/x424/releases/tag/v0.1.3)
- Source and merge commit: `4c862a2e37d85e8dd7861630a90bf7881c115e55`
- Reviewed merge:
  [pull request 42](https://github.com/x424protocol/x424/pull/42)
- Required CI:
  [GitHub Actions run 30323405338](https://github.com/x424protocol/x424/actions/runs/30323405338)
- Release workflow:
  [GitHub Actions run 30323535984](https://github.com/x424protocol/x424/actions/runs/30323535984)

The repository-bound npm trusted publisher is restricted to
`x424protocol/x424` and `.github/workflows/release.yml`. The release workflow
used Node 24 and npm 11.16.0; both the npm and verifier-image jobs completed
successfully. No long-lived npm automation token was used.

## Package artifact

- Registry: [`x424@0.1.3`](https://www.npmjs.com/package/x424/v/0.1.3)
- Registry tarball:
  [`x424-0.1.3.tgz`](https://registry.npmjs.org/x424/-/x424-0.1.3.tgz)
- Registry integrity:
  `sha512-qieKbgGCz7OZTjvHzj3Stgp3SHf3wc1iF+u/Od+pxx1GH9Us7OHaqvxOIJdVKxGCb6v8FwNEk/ReOcOfPG8Apw==`
- Attached copy:
  [`x424-0.1.3.tgz`](https://github.com/x424protocol/x424/releases/download/v0.1.3/x424-0.1.3.tgz)
- Checksum file:
  [`SHA256SUMS`](https://github.com/x424protocol/x424/releases/download/v0.1.3/SHA256SUMS)
- SHA-256:
  `6237366cdeeda66f4451edd71e6571c317eb7113363b0cefa58d2fd4caf85c9d`
- Size: 243,420 bytes

The attached tarball is the exact npm registry artifact. The release workflow
installed the packed package into a clean consumer, imported the maintained
core, browser client, World client, framework, managed-verifier, x402, Redis,
and MCP surfaces, and reported zero npm vulnerabilities.

```bash
npm install x424@0.1.3
```

## Verifier image

- Tag: `ghcr.io/x424protocol/x424-verifier:0.1.3`
- Digest:
  `sha256:d97587f1d7c5b8cffda7753a9da24da9b4a2da1880b339133fc4bac3ff6bfbcd`
- Platform: `linux/amd64`
- Runtime user: `10001`
- Visibility: public

The release workflow generated an SPDX SBOM, attached registry provenance and
SBOM attestations, and signed the digest with Cosign using GitHub OIDC. Pull by
digest for immutable evaluation:

```bash
docker pull ghcr.io/x424protocol/x424-verifier@sha256:d97587f1d7c5b8cffda7753a9da24da9b4a2da1880b339133fc4bac3ff6bfbcd
```

The repository Helm values pin this exact digest. Operators upgrading from
0.1.2 or earlier must still follow the
[tenant-state namespace cutover runbook](../runbooks/state-namespace-0.1.3.md).

## Verification summary

- 24 test files and 110 tests passed on the tagged source;
- type checking, build, browser-bundle smoke, MCP HTTP initialization, and
  forged-Host rejection passed;
- the browser smoke rejected Node built-ins and completed the synthetic
  `424 → proof → 201` exchange;
- Helm 3/4 lint, strict values validation, Kubernetes 1.25/1.31 schema checks,
  restricted-production egress, immutable-image, trusted-proxy, and
  single-replica guards passed;
- the non-root image booted with Redis and passed health, tenant-state,
  legacy-migration, same-operation acceptance, and replay-rejection checks;
- pull-request CodeQL analysis passed;
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
