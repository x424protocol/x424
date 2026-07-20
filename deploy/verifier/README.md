# x424 verifier distribution

Image goals (P2-01):

- non-root (`uid 10001`)
- config validation before traffic for `eval-redis-0.2` / `prod-ha-0.2`
- separate `/healthz` and `/readyz`
- graceful SIGTERM shutdown
- SBOM/signing performed in the release workflow (not fabricated here)

## Build

```bash
docker build -f deploy/verifier/Dockerfile -t x424-verifier:0.1.0 .
```

## Compose (evaluation only)

```bash
docker compose -f deploy/verifier/docker-compose.yml up --build
```

Replace placeholder keys. Never use compose defaults in production.

## Full router wiring

Production deployments construct `createX424HttpRouter` with:

- `issuanceAuthenticator`
- `RedisX424Store` or `PostgresX424Store`
- `deploymentProfile: "eval-redis-0.2"` or `"prod-ha-0.2"`
- rate limiter and provider egress allowlist

The image entrypoint validates configuration and serves probes; operators attach
the Express router in their process module or a follow-on release that embeds
the full server main.
