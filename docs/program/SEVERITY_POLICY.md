# Severity policy

Version: `severity-policy-0.1`  
Status: program baseline  
Applies to: protocol, reference implementation, runtime profiles, provider
adapters, conformance tools, and deployment assessment findings.

## Severity definitions

### Critical

A finding that enables forgery, silent policy weakening, privacy boundary
breakage, or cross-tenant crossover under intended production use. Critical
findings **must not** be accepted for any production profile.

Examples:

- accepting a result without authentic signature verification against trusted keys;
- silent activation of another provider, method, descriptor, mode, or legacy path;
- raw proof, provider nullifier, pairwise-derivation secret, or signing material
  leaving the trusted verifier boundary via logs, errors, traces, queues, or API;
- forging or replaying a dependency/result across audiences or tenants;
- SSRF or request-smuggling that reaches provider or metadata origins from
  client-controlled input;
- algorithm confusion that accepts a weaker signature algorithm as EdDSA.

### High

A finding that substantially increases exploitation likelihood or impact but
has a plausible compensating control. High findings require:

1. independent reviewer approval (not the component author);
2. a named owner;
3. documented compensating controls;
4. an explicit expiry date; and
5. a release-blocking remediation milestone.

Examples: missing rate limits on a production verifier, incomplete key
revocation path, header truncation risk without alternate transport, clock-skew
tolerance above the named profile, incomplete failover evidence.

### Medium

A finding that degrades reliability, operability, or defense-in-depth without
immediate protocol forgery. Must be tracked; may ship in developer-preview
profiles with documentation.

### Low

Cosmetic, documentation, or non-security quality issues that do not weaken
fail-closed behavior.

## Exception policy

| Severity | `dev-local-0.1`                       | `eval-redis-0.2`               | `prod-ha-0.2` / later                  |
| -------- | ------------------------------------- | ------------------------------ | -------------------------------------- |
| Critical | must fix before promoting beyond demo | must fix                       | must fix; blocks release               |
| High     | document and track                    | time-bounded exception allowed | independent approval + expiry required |
| Medium   | track                                 | track                          | track; prefer fix before tag           |
| Low      | discretionary                         | discretionary                  | discretionary                          |

No exception may:

- accept more proofs than the exact accepted methods declare;
- enable hidden fallback;
- store or emit raw proofs, provider subjects, nullifiers, or secrets;
- treat `HUMAN-PROOF` as application authorization;
- silently reinterpret a protocol or descriptor version.

## Release-gate mapping

- **0.1 developer preview:** zero Critical in the Phase 1 design review; every
  High closed or assigned a time-bounded disposition under this policy.
- **0.2 production candidate:** zero Critical; no unaccepted High against the
  named deployment profile under assessment.
- **1.0 stable:** zero Critical and no unaccepted High across protocol,
  deployment, privacy, and delta reviews.

## Recording findings

Each finding record must include severity, affected profile, artifact/commit,
reproduction, impact, disposition (`fixed` / `accepted-with-expiry` /
`deferred-non-prod`), owner, expiry, and linked vectors or tests.
