# Adopter contract

x424 succeeds when an adopter configures human-dependency policy instead of
designing a new verification protocol. This document defines that boundary.

## The adoption promise

For a supported provider profile, an adopter should write only:

1. provider credentials and environment configuration;
2. the exact methods accepted for each protected purpose;
3. a binding extractor for its authenticated wallet, session, request, or
   agent key;
4. provider UI appropriate to its platform; and
5. application authorization and idempotent business logic.

The x424 implementation should own:

- the `424` challenge and `HUMAN-REQUIRED` encoding;
- signed provider request construction;
- provider-proof submission and strict verification;
- request, audience, purpose, time, and caller binding;
- private provider-subject handling and pairwise result derivation;
- provider-subject, dependency, and result replay controls;
- result signing, verification, and retry; and
- conformance tests for every public integration surface.

Provider credentials and application policy are configuration. Reimplementing
signature formats, nullifier handling, proof forwarding, request binding, or
replay control is a failure of the adoption promise.

## What off the shelf means

“Off the shelf” means that a competent team can protect one endpoint with a
supported provider in one working day without writing cryptographic or x424
wire-protocol code. It does not mean zero application code. The provider still
owns its human ceremony, and the application still owns authorization.

A release meets this bar only when an adopter can:

- install a versioned package;
- run a production-shaped verifier or use a conforming verifier service;
- configure durable state and managed keys through documented interfaces;
- select one exact provider profile;
- use maintained client and server middleware; and
- test the complete failure path locally without real proof data.

## First-adopter rule

First adopters use the same public package, schemas, adapters, and verifier
interfaces as every other adopter. They receive no reserved fields, hidden
claims, privileged namespaces, or application-specific acceptance behavior.

When an adopter exposes a missing capability, maintainers classify it before
changing core:

| Capability                                                   | Home             |
| ------------------------------------------------------------ | ---------------- |
| Portable dependency or security behavior                     | x424 core        |
| Provider-native ceremony or verification                     | provider profile |
| Storage, key custody, or deployment integration              | runtime package  |
| Product permission, account state, payment, or business rule | adopter          |

Core changes must generalize beyond one adopter and ship with negative
conformance vectors. Provider changes must preserve exact claims and
non-claims.

## Verifier choice

x424 permits self-hosted, managed, and provider-operated verifiers. No verifier
is canonical. Resource servers trust explicit verifier keys and exact method
descriptors.

A conforming managed verifier may remove operational work, but it cannot
silently choose providers, widen scopes, reinterpret assurance, or become an
authorization authority. A self-hosted verifier must preserve the same wire
and conformance behavior.

## Acceptance test

Before calling an integration turnkey, verify that:

1. a fresh application can integrate from public documentation alone;
2. the application contains no provider-proof parsing or x424 token code;
3. browser and agent clients satisfy the same protected endpoint;
4. replay, wrong-binding, wrong-purpose, wrong-provider, expiry, and outage
   cases fail closed;
5. replacing the verifier does not change the protected resource contract;
6. adding a second provider does not change x424 core; and
7. the adopter deletes more custom verification code than it adds.
