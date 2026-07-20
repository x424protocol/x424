# Security model

## Status

Unaudited pre-alpha. The reference router and in-memory stores must not protect
production access or value.

## Invariants

1. A result is accepted only after authentic provider verification and native
   binding validation.
2. Provider, method, descriptor version, assurance, uniqueness scope, and
   verification mode cannot be substituted.
3. Requirement and result bind purpose, audience, exact request digest, caller,
   nonce, and time.
4. Provider nullifiers and raw proofs never leave the adapter/verifier boundary.
5. Pairwise IDs differ across relying-party audiences and methods.
6. Challenge nonce and mutation result ID are atomically consumed.
7. Unknown, disabled, stale, expired, malformed, wrong-audience, wrong-request,
   or wrong-binding state fails closed.
8. Verification does not imply identity attributes, authorization, delegation,
   payment, safety, competence, reputation, or legal accountability.
9. Provider outages do not silently activate another provider or weaker mode.
10. Recovery/key rotation cannot silently create a second accepted human in the
    same relying-party uniqueness domain.
11. Accepting multiple providers does not imply cross-provider deduplication;
    the relying party must prevent duplicate participation when its policy
    requires one person across provider boundaries.

## Threats and controls

| Threat                              | Required control                                                     |
| ----------------------------------- | -------------------------------------------------------------------- |
| Forged requirement                  | TLS, trusted issuance endpoint, optional signed requirement metadata |
| Forged result                       | Ed25519 verification with authenticated `kid` metadata               |
| Provider/method downgrade           | exact immutable descriptor and negative tests                        |
| Claim or assurance strengthening    | descriptor claim/non-claim and provider-local assurance comparison   |
| Nullifier or stable-subject leakage | pairwise HMAC, log exclusion, no public result field                 |
| Cross-RP correlation                | audience in derivation, no universal subject registry                |
| Cross-provider duplicate person     | explicit relying-party deduplication or single-provider policy       |
| Agent token theft                   | agent-key/sender binding, short TTL, replay consumption              |
| Request substitution                | canonical method/URI/body digest in requirement/result               |
| Result lifetime extension           | result window bounded by the original dependency                     |
| Challenge replay                    | shared atomic `(dependencyId, nonce)` consumption                    |
| Result replay                       | shared atomic `resultId` consumption plus app idempotency            |
| Concurrent double execution         | DB/Redis uniqueness or transaction; never process-local map          |
| Adapter lies about semantics        | conformance vectors, isolation, code review, kill switch             |
| Provider API confusion              | pinned origin/RP/action/environment and strict response parser       |
| Proof in logs/traces                | field-level redaction, body exclusion, bounded error messages        |
| HMAC secret rotation split          | versioned namespace, planned overlap/cutover, uniqueness audit       |
| Signing-key compromise              | managed/HSM key, short tokens, authenticated key rotation/revocation |
| Chain reorganization                | per-chain finality/reorg policy; unresolved state fails closed       |
| Backend/chain disagreement          | explicit precedence/compound policy; no optimistic fallback          |
| Header abuse                        | 64 KiB cap, strict base64url/JSON/schema validation, no reflection   |
| CORS/CSRF on verifier UI            | same-origin design, explicit origins, CSRF protection, user consent  |
| SSRF through provider metadata      | fixed/allowlisted verifier origins; never fetch client URLs          |

## World ID-specific controls

- Generate RP request signatures only on the backend. Never expose the RP
  signing key to a browser, public environment variable, log, or MCP tool.
- Forward the exact IDKit result to World's current v4 verifier; do not trim,
  convert, or rebuild native proof fields.
- Validate protocol version, environment, RP/action, credential identifier,
  nonce, and the exact application signal/binding before accepting remote
  success.
- The reference adapter binds the World signal to the x424 binding. Applications
  may add a `validateBinding` callback for stricter session or account policy;
  the callback never weakens the built-in check.
- Reject legacy credentials in the current Proof of Human profile. World v3
  and v4 credentials can have different nullifiers, so accepting both under one
  method can violate one-human-one-action semantics.
- Store uniqueness material using canonical representation and atomic unique
  constraints where the provider method requires replay detection.
- World ID 4 uniqueness nullifiers are one-time. Local deletion cannot be
  assumed to reset provider eligibility; recovery must preserve or explicitly
  migrate the relying-party human namespace.
- Treat each registered World action as a real uniqueness namespace. The x424
  dependency ID and World signal bind context but do not make the same human
  eligible again under a reused action.
- Do not substitute session proof/`session_id` continuity for action-scoped
  uniqueness unless a separately versioned method explicitly permits it.

## Cryptographic notes

The reference result token signs canonical JSON with Ed25519. It is intentionally
small, but production interoperability still needs:

- a frozen cross-language canonicalization test suite;
- authenticated verifier metadata and key discovery;
- key validity intervals and revocation;
- HSM/KMS custody and separation of result-signing and pairwise-HMAC keys;
- deterministic negative vectors and fuzzing; and
- independent cryptographic and protocol review.

The current canonical JSON helper sorts object keys but does not claim formal
RFC 8785 compatibility. Do not implement another language from prose alone;
use published vectors and compare byte-for-byte.

## Reference implementation limitations

- `InMemoryNonceStore`, `InMemoryRequirementStore`, and
  `InMemoryResultReplayStore` are single-process and lose state on restart.
- `RedisX424Store` supplies atomic shared state, but production deployments must
  still secure, monitor, back up, and test their Redis topology.
- The router has no authentication, authorization, CORS policy, rate limiter,
  durable audit, or abuse control.
- MCP tools intentionally do not accept raw provider proof material.
- No independent audit, fuzz campaign, formal verification, or production load
  test has been completed.

These are explicit non-production boundaries, not optional hardening.
