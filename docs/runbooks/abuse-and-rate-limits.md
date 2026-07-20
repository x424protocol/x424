# Runbook: abuse and rate limits

## Controls

- Per-IP / per-issuer rate limits on `/v1/requirements` and verify
- Provider egress allowlists
- Circuit breakers on provider HTTP
- Proof-safe telemetry only (`redactForTelemetry`)

## Actions

1. Identify hot keys from redacted metrics (issuer subject, route, status).
2. Tighten limits; do not inspect native proof bodies.
3. If credential stuffing against issuance tokens is suspected, rotate bearer /
   service identity credentials.
4. Preserve fail-closed verify behavior under load (prefer 429/503 over skipping
   replay checks).
