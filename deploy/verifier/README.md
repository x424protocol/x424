# Self-hosted x424 verifier

The published image is a runnable non-root verifier, not a wiring skeleton. It
serves authenticated requirement issuance, World proof verification,
`/healthz`, and `/readyz`; retains requirements, dependency nonces, private
provider-subject digests, result replay markers, and rate limits in Redis; and
same-operation result acceptances, encrypted brokered handoffs, and rate limits
in Redis; and shuts down gracefully.

The signed `0.1.0` evaluation image is public:

```bash
docker pull ghcr.io/x424protocol/x424-verifier@sha256:ccd5601aea7e5f568933d06a7948539e33b75a9d3a2b5ed5afdd6eb04590d84c
```

See the [0.1.0 release evidence](../../docs/program/RELEASE_0.1.0.md) for the
source tag, workflow, provenance, SBOM, signature, and maturity boundary.

## Local evaluation

Replace the staging World values in `docker-compose.yml`, then run:

```bash
docker compose -f deploy/verifier/docker-compose.yml up --build
```

Issue a dependency with `Authorization: Bearer eval-token`. Compose generates
an ephemeral result key at startup; its public pairwise secret is a local
fixture and must never be reused. Eval/prod profiles reject ephemeral keys.

## Provider-request modes

- `X424_PROVIDER_REQUEST_MODE=verifier`: the verifier signs World request
  material and requires `WORLD_RP_SIGNING_KEY`.
- `X424_PROVIDER_REQUEST_MODE=issuer`: an authenticated adopter backend signs
  World request material. The verifier never receives the RP signing key and
  validates app, RP, action, environment, binding, method, and lifetime before
  retaining the requirement.

Exactly one mode is accepted at startup.

## Production key boundary

`prod-ha-0.2` rejects exported `X424_RESULT_PRIVATE_KEY` and
`X424_PAIRWISE_SECRET`. Mount a JavaScript module and set `X424_KEY_MODULE` to
its absolute path. It must export `resultSigner`, `pairwiseDeriver`, and
`handoffStateProtector` objects implementing the public non-exportable
interfaces. The module is the integration point for the operator's KMS/HSM; no
key bytes enter x424. Development/evaluation profiles instead require an exact
32-byte `X424_HANDOFF_STATE_KEY`; never reuse it between environments.

## Required production controls

- Redis with authentication, TLS, persistence, tested backups, and restricted
  network access
- least-privilege token principals in `X424_ISSUANCE_PRINCIPALS_JSON`
- a mounted KMS/HSM module and published signed verifier metadata
- encrypted handoff state, capability-digest storage, and the brokered-handoff
  operational runbook
- ingress TLS, request-size enforcement, network policy, and World-only egress
- signed image verification, SBOM retention, and the runbooks in `docs/runbooks/`

The Helm chart supplies workload-level probes, non-root restrictions, resource
limits, and network-policy defaults. Secrets are deliberately not rendered by
the chart.
