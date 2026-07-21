# x424 0.1.0 release evidence

> Published 2026-07-21 · unaudited developer preview

This record identifies the public artifacts produced from the `v0.1.0` source
tag. It does not satisfy or waive the external wire review, managed sandbox,
production assessment, or independent-adoption gates.

## Source and workflow

- Signed source tag: [`v0.1.0`](https://github.com/x424protocol/x424/releases/tag/v0.1.0)
- Source commit: `de2f8a69e29e4c50fd8c9467a7777e130b8fa740`
- Release workflow: [GitHub Actions run 29855468666](https://github.com/x424protocol/x424/actions/runs/29855468666)

The workflow passed the complete repository check, quickstart, packed-package
smoke test, image build, SBOM generation, image provenance attestation, SBOM
attestation, and keyless image signature. Direct npm publication reached the
registry with a Sigstore provenance statement but was rejected because the new
unscoped package still requires one-time npm user-owner bootstrap.

## Package artifact

- Artifact: [`x424-0.1.0.tgz`](https://github.com/x424protocol/x424/releases/download/v0.1.0/x424-0.1.0.tgz)
- SHA-256: `217e1c11865690091b9ffc5b10f769d451923757a9e83f6892a7d466b74e5d60`
- Size: 222,981 bytes

The attached artifact was installed into a clean temporary project and its
public `x424`, `core`, `client`, `world`, `express`, `fetch`, `next`, and `mcp`
imports were loaded successfully. Until npm owner bootstrap is complete:

```bash
npm install https://github.com/x424protocol/x424/releases/download/v0.1.0/x424-0.1.0.tgz
```

## Verifier image

- Tag: `ghcr.io/x424protocol/x424-verifier:0.1.0`
- Digest: `sha256:ccd5601aea7e5f568933d06a7948539e33b75a9d3a2b5ed5afdd6eb04590d84c`
- Platform: `linux/amd64`
- Visibility: public

The workflow attached GitHub provenance and SPDX SBOM attestations to this
digest and signed it with Cosign using GitHub OIDC. Pull by digest for immutable
evaluation:

```bash
docker pull ghcr.io/x424protocol/x424-verifier@sha256:ccd5601aea7e5f568933d06a7948539e33b75a9d3a2b5ed5afdd6eb04590d84c
```

## Verification summary

- 24 test files and 100 tests passed;
- `424 → proof → bound retry → 201` quickstart passed;
- packed-package installation and public-import smoke tests passed;
- website build and rendered-HTML test passed;
- website audit reported zero moderate-or-higher vulnerabilities; and
- anonymous package-asset download and container-manifest retrieval passed.
