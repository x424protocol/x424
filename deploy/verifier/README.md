# Self-hosted x424 verifier

The published image is a runnable non-root verifier, not a wiring skeleton. It
serves authenticated requirement issuance, World proof verification,
`/healthz`, and `/readyz`; retains requirements, dependency nonces, private
provider-subject digests, result replay markers, and rate limits in Redis; and
same-operation result acceptances and encrypted brokered handoffs in Redis; and
shuts down gracefully.

The signed 0.1.3 developer-preview image remains public:

```bash
docker pull ghcr.io/x424protocol/x424-verifier@sha256:d97587f1d7c5b8cffda7753a9da24da9b4a2da1880b339133fc4bac3ff6bfbcd
```

See the [0.1.3 release evidence](../../docs/program/RELEASE_0.1.3.md) for the
source tag, workflow, npm artifact, provenance, SBOM, signature, and maturity
boundary. The previous 0.1.2 image is historical evidence only and must not be
deployed; 0.1.3 fixes verifier isolation and protected-response cache
boundaries. Version 0.1.4 additionally places the protected metadata route
behind the shared Redis limiter and is staged for publication. Until 0.1.4 is
published, place 0.1.3 behind an external ingress rate limit and use bearer
credentials generated from at least 32 random bytes.

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

Both staging and production proof submissions use World's canonical
`https://developer.world.org/api/v4/verify/{rp_id}` endpoint. Preserve the
exact IDKit result and allow TLS egress to that host; do not rewrite proof
fields or select a different endpoint in application code.

## Tenant-isolated state

Authenticated non-development deployments require tenant-aware requirement
storage. A custom backend must implement `TenantIsolatedRequirementStore`,
including the literal `tenantIsolation: true` marker and atomic
`putForTenant`, `getForTenant`, and `deleteForTenant` methods. The router passes
an opaque one-way tenant identifier; the store must enforce it on every
operation. A generic ownerless `RequirementStore` is accepted only by the
explicit local-development wildcard profile.

The router supplies opaque tenant-scoped result IDs. When authenticated result
endpoints are enabled, custom replay and acceptance backends must implement the
`LegacyAwareResultReplayStore` and `LegacyAwareResultAcceptanceStore`
interfaces so the old-key check and new scoped-key write are atomic. Base-only
stores are rejected. The maintained in-memory, Redis, and PostgreSQL stores
implement those contracts; this defense does not make a mixed-version rolling
deployment safe.

## Helm evaluation

The chart is staged for 0.1.4 with the `0.1.4` tag and an empty digest; it does
not retain the previous 0.1.3 image digest. After release automation publishes
the image, set `image.digest` to the published 0.1.4 digest before deploying
valuable traffic. The other defaults select the `eval-redis-0.2` runtime
controls, World staging, issuer-supplied provider requests, and one replica.
Selecting `prod-ha-0.2` also makes a non-empty immutable `image.digest`
mandatory; the chart refuses a mutable production tag. Put the required
environment variables in an existing Secret; the chart deliberately does not
render key material:

```bash
kubectl create namespace x424
kubectl --namespace x424 create secret generic x424-verifier \
  --from-env-file=/secure/path/x424-verifier.env
helm upgrade --install x424-verifier deploy/verifier/helm \
  --namespace x424 \
  --set-string image.digest=sha256:REPLACE_WITH_PUBLISHED_0_1_4_DIGEST
```

For the default mode, the Secret must supply `REDIS_URL`,
`X424_ISSUANCE_PRINCIPALS_JSON`, result-signing and pairwise key configuration,
`X424_HANDOFF_STATE_KEY`, `WORLD_APP_ID`, `WORLD_RP_ID`, and `WORLD_ACTION`.
Keep the environment file outside the repository and shell history.
For every `prod-ha-0.2` principal, generate the JSON object key from at least
32 random bytes (for example, `openssl rand -base64 32`); literal example
tokens are rejected in production.

The image also requires `X424_REDIS_TOPOLOGY=single-endpoint`; the chart sets
it. Redis Cluster is rejected in 0.1.3 because the safe legacy/new-key cutover
uses multi-key Lua and pre-0.1.3 keys do not share a hash slot. A standalone
Redis primary or one primary endpoint managed through failover is supported.

Upgrading from 0.1.2 or earlier requires a full maintenance window: stop old
verifier and protected-resource traffic, wait at least 15 minutes, and then
deploy 0.1.3 or later. Do not use a rolling update or immediate rollback.
Follow the
[0.1.3 tenant-state namespace cutover runbook](../../docs/runbooks/state-namespace-0.1.3.md).

The chart intentionally enforces one replica and uses a `Recreate` deployment
strategy. World IDKit session handles are process-local: a poll routed to a
different process, a restart, or an upgrade can fail an active handoff with
`WORLD_SESSION_LOST`. Drain active handoffs before planned changes. The
single-replica chart does not satisfy the availability targets of
`eval-redis-0.2` or `prod-ha-0.2`; multi-replica deployment stays blocked until
World sessions are resumable or owner-routed.

With the NetworkPolicy enabled, the functional evaluation default permits any
source to the service port plus DNS, outbound TCP 443, and outbound TCP 6379.
Empty egress CIDR lists mean any destination on that port. Selecting
`prod-ha-0.2` fails chart rendering unless the policy is enabled; at least one
reviewed ingress source is configured through `ingressCidrs`,
`ingressNamespaceLabels`, or `ingressPodLabels`; and `dnsCidrs`, `worldCidrs`,
and `redisCidrs` are all non-empty. Namespace and pod labels form one combined
NetworkPolicy peer. Use reviewed ranges and set `redisPort` when Redis uses a
non-default or TLS port. Validate all selectors against the cluster CNI because
NetworkPolicy treatment of service and post-NAT addresses varies.

`config.trustProxyHops` defaults to zero, so untrusted forwarded IP headers
cannot influence authentication-attempt rate limits. When an ingress is the
only network path to the verifier, set it to the exact count of
operator-controlled reverse proxies between the client and Express. The chart
refuses a nonzero value unless its NetworkPolicy is enabled with an explicit
ingress source. Never trust forwarded headers while pods remain directly
reachable from an untrusted network.

Run the same pinned Helm and Kubernetes-schema checks used by CI:

```bash
bash scripts/verify-helm-chart.sh
```

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
- least-privilege token principals in `X424_ISSUANCE_PRINCIPALS_JSON`, with
  each production bearer generated from at least 32 random bytes and encoded
  as canonical hexadecimal, base64, or base64url
- a mounted KMS/HSM module and published signed verifier metadata
- encrypted handoff state, capability-digest storage, and the brokered-handoff
  operational runbook
- ingress TLS, request-size enforcement, exact trusted-proxy hops, the durable
  Redis metadata/authentication limiter, and reviewed DNS/provider/Redis/KMS
  egress allowlists
- signed image verification, SBOM retention, and the runbooks in `docs/runbooks/`

The Helm chart supplies workload-level probes, non-root restrictions, resource
limits, support for immutable `image.digest` references, a disruption budget,
and network-policy defaults. The staged release tag is not an immutable
reference; set `image.digest` before valuable traffic. Secrets are deliberately
not rendered by the chart.
