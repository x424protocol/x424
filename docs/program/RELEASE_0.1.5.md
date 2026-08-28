# x424 0.1.5 release evidence

> Published 2026-08-28 · unaudited developer preview

This record identifies the public artifacts produced from the SSH-signed
`v0.1.5` source tag. It records an audited dependency refresh, current Node 24
release actions, browser bundle budgets, and an updated Sites/vinext build
stack. It does not change the x424 wire profile or satisfy the external wire
review, managed sandbox, real-device World, production assessment, high
availability, or independent-adoption gates.

## Source and workflows

- SSH-signed source tag and developer-preview prerelease:
  [`v0.1.5`](https://github.com/x424protocol/x424/releases/tag/v0.1.5)
- Source and release commit: `017c6e67a3d473cf1844591d00909004eaabb720`
- Reviewed maintenance changes:
  [site security](https://github.com/x424protocol/x424/pull/56),
  [Node 24 actions](https://github.com/x424protocol/x424/pull/57),
  [protocol dependencies](https://github.com/x424protocol/x424/pull/58), and
  [release preparation](https://github.com/x424protocol/x424/pull/59)
- Required CI on the tagged commit:
  [GitHub Actions run 33203760253](https://github.com/x424protocol/x424/actions/runs/33203760253)
- CodeQL on the tagged commit:
  [GitHub Actions run 33203760331](https://github.com/x424protocol/x424/actions/runs/33203760331)
- Release workflow:
  [GitHub Actions run 33203943399](https://github.com/x424protocol/x424/actions/runs/33203943399)

The repository-bound npm trusted publisher remains restricted to
`x424protocol/x424` and `.github/workflows/release.yml`. The release workflow
used Node 24 and npm 11.16.0; both the npm and verifier-image jobs completed
successfully. No long-lived npm automation token was used.

The tag object contains an SSH signature. GitHub reports `unknown_key` because
the signing public key is not registered as a GitHub signing key, so this
record does not claim GitHub-verified tag status.

## Package artifact

- Registry: [`x424@0.1.5`](https://www.npmjs.com/package/x424/v/0.1.5)
- Registry tarball:
  [`x424-0.1.5.tgz`](https://registry.npmjs.org/x424/-/x424-0.1.5.tgz)
- Registry integrity:
  `sha512-uZSoll/34I3wEez9md4VeA1DQJGEplmDuuGHorGvAx8Kmkc1Ixq/nB+roHUDxlWjeL+b6j97xv4c1GFEY+yN5w==`
- npm provenance:
  [`x424@0.1.5` attestations](https://registry.npmjs.org/-/npm/v1/attestations/x424@0.1.5)
- Attached copy:
  [`x424-0.1.5.tgz`](https://github.com/x424protocol/x424/releases/download/v0.1.5/x424-0.1.5.tgz)
- Checksum file:
  [`SHA256SUMS`](https://github.com/x424protocol/x424/releases/download/v0.1.5/SHA256SUMS)
- SHA-256:
  `a2f27d6cabe26e3fc560d6ae200b14b35885ca3c2c13bd416358e9976c501456`
- Size: 250,172 bytes

The attached tarball is the exact npm registry artifact and is byte-identical
to npm 11.16.0 packing the tagged source. A clean consumer imported the
maintained core, browser client, World client, framework, managed-verifier,
x402, Redis, and MCP surfaces. `npm audit signatures` verified 123 registry
signatures and 15 provenance attestations, and the shipped dependency audit
reported zero known vulnerabilities.

```bash
npm install x424@0.1.5
```

## Verifier image

- Tag: `ghcr.io/x424protocol/x424-verifier:0.1.5`
- Digest:
  `sha256:7972f248786346fb83d3567fe58ec3d420c728c7a4109010bcbab5d4a81eeec6`
- Runtime user: `10001`
- Visibility: public
- Attached SPDX SBOM:
  [`x424-verifier-v0.1.5.spdx.json`](https://github.com/x424protocol/x424/releases/download/v0.1.5/x424-verifier-v0.1.5.spdx.json)
- SBOM SHA-256:
  `a1f2595020bc77f7802637bbbe4054428da21bf43e9e559d894f8a18bfe097da`

The release workflow attached registry provenance and SBOM attestations and
signed the exact digest with Cosign using GitHub OIDC. Pull by digest for
immutable evaluation:

```bash
docker pull ghcr.io/x424protocol/x424-verifier@sha256:7972f248786346fb83d3567fe58ec3d420c728c7a4109010bcbab5d4a81eeec6
```

The repository Helm values pin this exact digest. Operators upgrading from
0.1.2 or earlier must still follow the
[tenant-state namespace cutover runbook](../runbooks/state-namespace-0.1.3.md).
There is no state-namespace change from 0.1.3 through 0.1.5.

## Verification summary

- 25 test files and 115 tests passed on the tagged source;
- type checking, build, conformance, browser-bundle smoke and budgets, MCP HTTP
  initialization, and forged-Host rejection passed;
- the quickstart completed the synthetic `424 → proof → 201` exchange;
- Helm 3/4 lint, strict values validation, Kubernetes 1.25/1.31 schema checks,
  restricted production ingress and egress, immutable-image, trusted-proxy,
  and single-replica guards passed;
- the non-root image booted with Redis and passed the production credential,
  metadata authentication/throttling, tenant-state, migration, acceptance,
  and replay gates;
- the root and full website dependency audits reported zero known
  vulnerabilities;
- pull-request and merged-commit CodeQL analyses passed, and the repository
  reported zero open code-scanning, dependency, and secret-scanning alerts;
  and
- the release workflow published npm provenance, image provenance, an SPDX
  SBOM attestation, and a keyless Cosign signature.

## Maturity boundary

This is publication and first-party automated evidence, not an independent
security or privacy assessment. The World profile still lacks a published
real-device staging matrix, the brokered World session remains process-local,
the chart remains a one-replica evaluation surface, Redis Cluster is
unsupported for the 0.1.3 migration, and no unrelated production adopter or
independent verifier has been demonstrated.
