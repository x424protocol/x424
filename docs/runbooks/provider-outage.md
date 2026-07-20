# Runbook: provider outage

## Rule

Provider outages **fail closed**. Do not silently activate another provider,
method, descriptor, assurance, mode, or legacy branch.

## Actions

1. Confirm circuit breaker open / provider egress errors (proof-safe metrics).
2. Keep exact accepted methods unchanged.
3. Return stable protocol errors without provider diagnostics that enable probing.
4. If business must continue, the **adopter** decides whether to deny the action
   or pause the product feature — not x424 fallback.
5. After recovery, validate provider fixtures and replay stores before reopening.

## Exit criteria

- No policy widening during the incident
- Telemetry shows no raw proof/nullifier fields
- Adopter recorded the business decision separately from x424
