# Brokered handoff operations

Applies to `eval-redis-0.2` and `prod-ha-0.2`. Never copy connector URIs,
capability tokens, encrypted provider state, or native proofs into an incident
ticket, log query, trace, or chat.

## Backlog or polling surge

1. Keep readiness closed if the durable handoff store or state-encryption key
   is unavailable.
2. Inspect aggregate counts by tenant, provider, status, and age only. Do not
   inspect handoff documents.
3. Apply the configured per-origin and per-tenant start/poll limits. Do not
   extend an existing dependency, provider request, or capability expiry.
4. Open the provider circuit breaker when error rate or latency crosses the
   deployment threshold. Existing handoffs remain pending only until their
   original expiry.
5. Scale stateless verifier workers only when the provider adapter supports
   resumable sessions. For the current World IDKit adapter, active session
   handles are process-local; scaling down or restarting loses those sessions.

## Graceful deployment

1. Stop new handoff starts on the instance and remove it from readiness.
2. Drain its active World IDKit sessions until completion or original expiry.
3. Keep durable generic handoff records available throughout the drain.
   Expired polling leases are reclaimed by another verifier worker.
4. Deploy only after the process-local World session count is zero.
5. Re-enable readiness and validate synthetic start, pending poll,
   cancellation, and capability rejection.

Unexpected loss of a process hosting a World session must return
`WORLD_SESSION_LOST`; never reissue a provider ceremony under the same handoff
or silently fall back to direct proof collection.

## Orphaned provider verification

1. Let the local handoff expire and release its active-dependency index.
2. Attempt provider cancellation when supported; local cancellation remains
   authoritative if the provider is unavailable.
3. Delete only records whose protocol expiry has passed and whose retention
   policy permits deletion.
4. Record aggregate orphan count, cause, and duration without stable subject or
   presentation data.
5. A client may start a new handoff only from a still-valid dependency and its
   exact nonce. Otherwise it must obtain a new 424 challenge.

## State-encryption key incident

1. Stop starts and polling; fail readiness closed.
2. Revoke the affected encryption-key version in operator configuration.
3. Treat undecryptable active handoffs as failed. Do not expose ciphertext or
   attempt plaintext recovery through logs.
4. Rotate through the normal KMS/HSM process and verify cross-tenant isolation.
5. Reopen only after capability-theft, wrong-key, cancellation, and expiry
   checks pass against packed artifacts.
