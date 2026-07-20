# Runbook: result-signing or pairwise-secret compromise

## Symptoms

- Unexpected valid results under a known `kid`
- Metadata shows a key still `active` after suspected exposure
- Backup media or log systems may have contained key material

## Immediate actions

1. Mark the `kid` / pairwise version `revoked` in authenticated metadata.
2. Stop issuing under the compromised key; activate the pre-staged next key.
3. Reject results whose `kid` is revoked (fail closed).
4. Rotate pairwise secret only as an **identity migration** with versioned
   namespace, overlap, collision audit, and rollback plan (ADR/P2-03).
5. Preserve audit logs (redacted); do not dump raw proofs.

## Maximum exposure window

Document wall-clock from earliest possible compromise to revocation
propagation across all resource servers (metadata cache TTL + push).
Target for `prod-ha-0.2`: ≤ 15 minutes metadata propagation.

## Exit criteria

- Compromised key status `revoked` in live metadata
- No new results issued under compromised material
- Overlap/migration plan executed or explicitly deferred with severity exception
