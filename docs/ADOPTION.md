# Adopting x424

x424 is a dependency protocol, not an account system. A relying party adopts
x424 at its HTTP boundary while retaining its own authentication,
authorization, identity lifecycle, and business rules.

The division of responsibility and the measurable “off-the-shelf” bar are in
[ADOPTER_CONTRACT.md](ADOPTER_CONTRACT.md).

## Integration contract

A conforming relying party:

1. authenticates the caller using its normal account, wallet, session, or
   agent-key mechanism;
2. declares every accepted unique-human method explicitly;
3. returns `424 Failed Dependency` with `HUMAN-REQUIRED` when the dependency is
   unsatisfied;
4. sends provider-native proof only to a configured verifier;
5. accepts a signed `HUMAN-PROOF` only after checking the exact request,
   audience, purpose, caller binding, method descriptor, freshness, and replay
   state; and
6. applies its own authorization and idempotency policy before executing the
   action.

An x424 result proves only the dependency named by the requirement. It does not
create an account, authorize an action, grant an agent a mandate, or establish
a durable relationship between a person and a key.

## Existing unique-human systems

Do not create a second human namespace merely to adopt x424. If an application
already has active human profiles produced by an accepted provider method, it
can expose those profiles through a separately versioned assertion adapter
whose claim and non-claims describe the migration provenance exactly.

An existing account assertion must not masquerade as a fresh provider proof.
For example, a historical enrollment and a new presence ceremony are distinct
methods even when they ultimately depend on the same provider.

Recommended migration:

1. wrap current decisions in observation-only mode;
2. compare current and x424 decisions without logging proofs or stable human
   identifiers;
3. enable one low-risk endpoint;
4. prove browser, REST, SDK, OpenAPI, and agent parity;
5. exercise replay, binding mismatch, provider outage, revocation, recovery,
   and signing-key rotation; and
6. expand only after the verifier and state stores meet the production
   controls in [SECURITY.md](SECURITY.md).

## New enrollments

A provider ceremony and x424 result issuance can occur in one user flow. The
client may handle the `424` challenge and retry automatically; x424 does not
require an additional user gesture beyond the accepted provider method.

The reference `fetchWithX424` client performs exactly one challenge resolution
and retry. Applications supply the trusted wallet/UI resolver; the protocol
client never chooses an unlisted provider or weakens the requirement.

`createHttpHumanDependencyResolver` owns the standard verifier submission.
Provider profiles can supply proof resolvers, so application code handles the
provider UI without rebuilding x424 request bodies or headers.

For the World profile, enabling legacy fallback does not add another user step.
One `proofOfHuman` ceremony may return v4 Proof of Human or legacy v3 Orb; the
resolver submits the exact method that actually completed. The two outcomes
remain separate trust branches and do not imply cross-version deduplication.

The relying party may persist its own account or membership projection from the
same verified event. That projection remains application authority and must not
be embedded in the x424 result.

## Multiple providers

Provider alternatives are explicit accepted branches, never interchangeable
identities. x424 does not determine whether subjects from two providers are the
same person and does not expose a universal cross-provider identifier.

Before accepting more than one provider for a one-person policy, a relying
party must define how it prevents cross-provider duplicate participation. That
policy may be a provider-specific uniqueness domain, an application-managed
linking process, or a separately governed deduplication system. x424 does not
invent or imply one.

## Agent flow

An agent can detect and escalate the dependency without receiving a provider
nullifier:

1. the agent receives `424 + HUMAN-REQUIRED`;
2. it presents the exact accepted methods and binding through a trusted wallet
   or user interface;
3. the human completes one accepted provider method;
4. the verifier returns a short-lived result bound to the agent-key
   fingerprint and request; and
5. the agent retries with `HUMAN-PROOF`.

Durable ownership, delegation, recovery, budgets, and revocation remain in a
separate authorization or mandate system.

## x402 composition

When an action requires both uniqueness and payment, evaluate x424 first:

```text
request -> x424 dependency -> x402 payment -> authorization -> execution
```

The final retry can carry both `HUMAN-PROOF` and the x402 payment payload. The
proofs stay independent: satisfying one never weakens or implies the other.

## Production boundary

The reference router is demonstrative. A production verifier requires:

- authenticated requirement issuance;
- distributed atomic requirement, dependency nonce, provider-subject, and
  result-consumption stores (the package includes a Redis implementation);
- managed signing and pairwise-derivation keys;
- strict provider origin, environment, method, and response validation;
- rate limits and capacity controls;
- proof-safe logging, tracing, analytics, and error handling;
- documented key rotation, revocation, recovery, and outage behavior; and
- independent security review.
