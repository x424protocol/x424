# Runbook: Redis/PostgreSQL restore

## Targets

Named profile RTO/RPO from `docs/program/DEPLOYMENT_PROFILES.md`.

## Actions

1. Stop issuance and verify traffic (readiness fail).
2. Restore from the latest backup within RPO.
3. Verify nonce, requirement, provider-subject digest, and result tables/keys.
4. Run concurrency consume smoke (duplicate proof / duplicate result → reject).
5. Re-enable readiness; monitor replay rejection rates.

## Prohibitions

- Do not rebuild replay state from application logs that may contain proofs.
- Do not shorten result TTLs to “clear” ambiguity after restore.
