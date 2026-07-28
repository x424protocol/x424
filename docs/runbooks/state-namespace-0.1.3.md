# Runbook: 0.1.3 tenant-state namespace cutover

This is a mandatory maintenance-window migration from 0.1.2 or earlier to
0.1.3 or later. Do not use a rolling deployment. The old release stored
requirement and result state without the authenticated issuer tenant namespace;
releases from 0.1.3 onward store and read that state under one-way tenant-scoped
identifiers.

The two layouts intentionally do not share keys. If old and new traffic
overlap, or if a 0.1.3-or-later release starts before an old result has expired,
a still-valid result that was consumed under the old layout could appear unused
in the new layout.

The maintained in-memory, Redis, and PostgreSQL result stores add an atomic
legacy-key check as defense in depth. Authenticated routers reject custom
result stores that do not implement the equivalent `LegacyAware` interfaces.
That check does not make a mixed-version rolling deployment safe, so the
complete drain remains mandatory for every backend.

## Preconditions

1. Schedule at least 15 minutes of complete x424 downtime plus deployment and
   validation time.
2. Pin the intended 0.1.3-or-later container by its published digest. A staged
   chart tag is mutable and is not a production pin.
3. Back up Redis/PostgreSQL according to the normal state-restore procedure.
   Do not export native proofs, bearer tokens, handoff capabilities, or
   provider subjects.
4. Verify every production issuance principal has the intended stable
   `issuer` and `subject`. Changing either value creates a different tenant
   namespace.
5. If the router uses a custom requirement backend, implement
   `TenantIsolatedRequirementStore` before cutover:
   `tenantIsolation: true`, `putForTenant`, `getForTenant`, and
   `deleteForTenant`. Each operation must enforce ownership atomically. A
   generic `RequirementStore` is rejected outside the local-development
   wildcard profile.
6. A custom result replay or acceptance backend must implement the matching
   legacy-aware interface. Its old-key check and new scoped-key write must be
   one atomic operation; base-only stores are rejected. This is supplemental
   protection, not a substitute for the drain.
7. The 900-second drain follows the protocol requirement/result lifetime
   ceiling. Do not purge longer-lived legacy markers from a nonconforming
   deployment: legacy-aware stores must continue rejecting them until their
   recorded expiry.
8. Redis deployments must use a single node or primary endpoint. Redis Cluster
   is unsupported for the migration introduced in 0.1.3 because legacy and
   tenant-scoped keys cannot share a cluster hash slot during the atomic
   cutover check.

## Cutover

1. Stop new brokered handoff starts and drain process-local World sessions to
   completion or their original expiry, following
   [handoff-operations.md](handoff-operations.md).
2. Put both the verifier API and every protected resource behind maintenance
   mode. Stop issuance, proof submission, handoff polling/cancellation,
   requirement state access, result consumption/acceptance, and protected
   business requests.
3. Stop all 0.1.2-or-earlier verifier and protected-resource processes. Confirm
   from ingress metrics that no old process accepted a request after the
   recorded stop time.
4. Wait **at least 900 seconds (15 full minutes)** from the last request
   accepted by any old process. Do not count build, image-pull, or deployment
   time toward this interval.
5. Do not copy ownerless requirement/result keys into the new namespace. The
   old keys lack trustworthy tenant ownership. Leave them unavailable and let
   their configured retention expire.
6. Deploy the intended 0.1.3-or-later release with `Recreate`, one replica, the
   stable principal configuration, and its pinned image digest.
7. Keep public ingress closed while completing the validation below. Reopen
   only after every check passes.

## Validation

1. Confirm `/healthz` and `/readyz` succeed and the runtime can reach Redis and
   `https://developer.world.org/api/v4/verify/{rp_id}` over TLS.
2. With two test principals, issue state as tenant A and confirm tenant B gets
   `404` for read and delete. Use principals with the same subject and
   different issuers as one isolation case.
3. Consume the same synthetic result ID once in each tenant. Each tenant's
   first consume succeeds; a second consume in the same tenant fails.
4. Repeat the equivalent same-operation/different-operation checks for result
   acceptance.
5. Exercise the complete `424 → provider proof → signed result → exact retry`
   flow. For direct low-level Fetch integration, finalize every downstream
   response with `finalizeFetchX424Response(response, protection.responseHeaders)`;
   the high-level `createFetchX424Handler()` does this automatically.
6. Confirm every protected response, including downstream `402` and success,
   carries `Cache-Control: no-store, private` and a `Vary` value containing
   `HUMAN-PROOF`.

## Rollback

Prefer a forward fix. Once 0.1.3-or-later traffic has been admitted, an
immediate rollback to 0.1.2 or earlier can recreate the same replay window in
the opposite direction because the old release cannot see new tenant-scoped
acceptance state.

If rollback is unavoidable, close verifier and protected-resource ingress
again, stop every 0.1.3-or-later process, and wait at least 900 seconds from the
last accepted request before starting a 0.1.2-or-earlier release. Record the
security exception and incident timeline.

A rollback from 0.1.4 to 0.1.3 does not cross the state-namespace boundary, so
this 900-second namespace rollback drain does not apply. The normal World
handoff drain in [handoff-operations.md](handoff-operations.md) still applies.
