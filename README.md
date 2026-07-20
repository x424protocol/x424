# x424

> Human Dependency Protocol · public pre-alpha · unaudited

[x424.org](https://x424.org) · [Protocol](docs/PROTOCOL.md) ·
[Adoption guide](docs/ADOPTION.md) · [OpenAPI](openapi/x424.openapi.json) ·
[Conformance vectors](conformance/v0.1/README.md) ·
[Governance](docs/GOVERNANCE.md)

**x424 makes an HTTP action depend on one explicitly accepted unique human.**

x402 makes an action depend on payment. x424 makes it depend on a unique-human
proof—whether the caller is a browser, wallet, backend, or autonomous agent.
The resource server returns `424 Failed Dependency` with `HUMAN-REQUIRED`. A
human completes one accepted provider method, a verifier issues a short-lived
result bound to the exact request and caller, and the client retries with that
result in `HUMAN-PROOF`.

x424 is provider-neutral and policy-explicit. It standardizes the dependency,
not the underlying proof system. Providers remain distinct; a relying party
must name every accepted provider, method, descriptor version, uniqueness
scope, assurance label, verification mode, and freshness rule.

## Wire flow

```text
Client or agent                   Resource server               x424 verifier
    | POST /action                      |                            |
    |---------------------------------->|                            |
    | 424 + HUMAN-REQUIRED              |                            |
    |<----------------------------------|                            |
    | human completes one accepted provider method                  |
    | POST provider-native proof ----------------------------------->|
    |<--------------------------- HUMAN-RESULT (signed, short-lived) |
    | POST /action + HUMAN-PROOF       |                            |
    |---------------------------------->| verify signature, request, |
    |                                  | audience, binding, replay  |
    | 2xx, or next dependency such as x402                           |
    |<----------------------------------|                            |
```

```http
HTTP/1.1 424 Failed Dependency
HUMAN-REQUIRED: <base64url-canonical-json>
Cache-Control: no-store, private
Vary: HUMAN-PROOF
Content-Type: application/problem+json
```

After verification:

```http
POST /action HTTP/1.1
HUMAN-PROOF: <x424-result+jws>
Idempotency-Key: <application-key-for-mutations>
```

Provider-native proofs never belong in an HTTP header or at the resource
server. `HUMAN-RESULT` is the verifier-to-client copy of the same signed result
token later carried in `HUMAN-PROOF`.

## Install

```bash
pnpm add x424
```

Package entry points keep the provider-neutral core separate from optional
integration surfaces:

```ts
import { createHumanRequirement } from "x424/core";
import { fetchWithX424 } from "x424/client";
import { defineHumanProviderAdapter } from "x424/adapters";
import { WorldIdAdapter } from "x424/providers/world-id";
import { createX424HttpRouter } from "x424/express";
import { createX424McpServer } from "x424/mcp";
```

The repository itself uses Node.js 22+ and pnpm 9+:

```bash
pnpm install
pnpm check
pnpm example
```

## Client retry

Agents and applications can use the same one-challenge/one-retry flow. The
resolver owns the selected provider ceremony and verifier call:

```ts
import { fetchWithX424 } from "x424/client";

const response = await fetchWithX424(url, requestInit, {
  resolveHumanDependency: async ({ requirement }) => {
    const humanProof = await walletOrUi.satisfy(requirement);
    return { humanProof };
  },
});
```

The helper retries only when both status `424` and a valid `HUMAN-REQUIRED`
header are present. It does not reinterpret ordinary dependency failures,
choose a provider silently, perform payment, or authorize the action.

## Declare a human dependency

The application decides which exact methods satisfy each action:

```ts
import { createHumanRequirement, humanRequiredResponse } from "x424/core";

const requirement = createHumanRequirement({
  purpose: "publish-record",
  method: "POST",
  uri: "https://api.example.com/records",
  audience: "https://api.example.com",
  body: requestBody,
  binding: { kind: "agent_key", value: agentPublicKeyFingerprint },
  accepts: acceptedHumanMethods,
  providerRequests: await buildProviderRequests(acceptedHumanMethods),
});

await sharedAtomicNonceStore.put(
  requirement.dependencyId,
  requirement.nonce,
  requirement.expiresAt,
);

const response = humanRequiredResponse(requirement);
// Send response.status, response.headers, and response.body.
```

`acceptedHumanMethods` is application policy, not a global x424 allowlist.
Installing an adapter never makes that provider acceptable automatically.

## Accept the retried request

```ts
import { defineMethodCatalog, verifyHumanProofHeader } from "x424/core";

const result = await verifyHumanProofHeader({
  humanProof: request.headers["human-proof"],
  requirement,
  verifier: trustedVerifierPublicKey,
  catalog: defineMethodCatalog(acceptedMethodDescriptors),
  replayStore: sharedAtomicResultStore,
});

// x424 is satisfied. The application still authenticates, authorizes,
// applies business rules, and executes idempotently.
```

For state-changing actions, consume `resultId` atomically and use the normal
application idempotency mechanism. x424 prevents proof reuse from becoming
human-dependency reuse; it does not prevent duplicate business execution by
itself.

## Build a provider adapter

Provider integrations use the public adapter contract without modifying core:

```ts
import {
  defineHumanMethodDescriptor,
  defineHumanProviderAdapter,
} from "x424/adapters";

const UNIQUE_HUMAN_METHOD = defineHumanMethodDescriptor({
  providerId: "example-provider",
  methodId: "unique-human",
  version: "1",
  status: "enabled",
  claim: "The provider accepted one unique human in its declared scope.",
  nonClaims: ["Legal identity", "Authorization", "Provider equivalence"],
  assuranceLevels: ["standard"],
  nativeScopeKinds: ["relying_party"],
  verificationModes: ["backend"],
  pairwisePseudonym: true,
  replaySemantics: "Provider proof and x424 nonce are single-use.",
  recoverySemantics: "Recovery is controlled by the provider.",
  privacy: "The provider subject remains inside the verifier boundary.",
});

export const adapter = defineHumanProviderAdapter({
  providerId: "example-provider",
  methods: [UNIQUE_HUMAN_METHOD],
  verify: async ({ requirement, proof }) => {
    const native = await verifyWithProvider(proof.nativeProof, requirement);
    return {
      providerId: "example-provider",
      methodId: "unique-human",
      descriptorVersion: "1",
      assuranceLevel: "standard",
      providerSubject: native.privateUniqueSubject,
      uniquenessScope: {
        kind: "relying_party",
        id: native.uniquenessNamespace,
      },
      verificationMode: "backend",
      proofDigest: digestNativeProof(proof.nativeProof),
      verifiedAt: native.verifiedAt,
    };
  },
});
```

Every adapter must document exact claims, non-claims, uniqueness scope,
binding, replay, recovery, privacy, and execution mode. Run `pnpm conformance`
and add provider-native positive and negative fixtures before proposing an
adapter.

World ID 4.0 Orb is the first reference adapter. It forwards the native IDKit
result to World's verifier without reshaping it, requires an application-owned
binding validator, and keeps the returned nullifier inside the verifier
boundary.

## Providers are not interchangeable

x424 does not create a universal human identifier or deduplicate subjects
across providers. A proof from provider A and a proof from provider B may belong
to the same person. Accepting both for a one-person policy therefore requires a
separate, explicit cross-provider duplicate-participation policy.

This is deliberate. Provider alternatives are named trust branches, never an
implicit universal score or equivalence claim.

## Agents and humans

x424 can bind a human dependency result to an agent public-key fingerprint for
one request or narrow purpose. It does not label the agent as human and does not
prove ownership, delegation, competence, authority, or continued human
control. Durable human-agent relationships belong in a separate consent,
mandate, recovery, and revocation system.

## x402 composition

A service that requires both uniqueness and payment evaluates them in this
order:

```text
request -> x424 -> x402 -> authorization -> idempotent execution
```

Once `HUMAN-PROOF` is valid, the same request may receive an x402 challenge.
The final retry carries both proofs. Neither protocol reinterprets or weakens
the other.

## What is included

- Canonical HTTP requirement/result codecs and request digests.
- Exact audience, purpose, nonce, time, and caller binding.
- Explicit provider alternatives without cross-provider equivalence.
- Provider-local global, relying-party, action, and session scopes.
- Ed25519 `x424-result+jws` signing and deterministic fail-closed evaluation.
- Atomic-store interfaces for challenge and mutation-result replay protection.
- Provider-adapter SDK and static conformance inspection.
- World ID 4.0 Orb reference adapter.
- Express reference router, OpenAPI 3.1, JSON Schemas, and MCP server.
- Fixed positive and negative cross-implementation conformance vectors.
- A no-build browser dependency console.

The repository does not contain a hosted verifier, production datastore,
production relying-party key, on-chain registry, identity wallet, generic
credential protocol, cross-provider deduplication system, or authorization
engine.

## Repository map

```text
src/                   Provider-neutral core and integration surfaces
src/providers/         Explicit provider reference adapters
schemas/               JSON Schema 2020-12 wire contracts
conformance/           Fixed cross-implementation vectors
openapi/               OpenAPI 3.1 reference contract
demo/                  Provider-safe dependency console
examples/              Generic HTTP and adapter examples
test/                  Core, security, conformance, MCP, and contract tests
docs/PROTOCOL.md        Normative x424/0.1 contract
docs/ARCHITECTURE.md    Trust boundaries and deployment shapes
docs/ADOPTION.md        Generic relying-party adoption and migration
docs/SECURITY.md        Threat model and production controls
docs/COMPOSITION.md     x401/x402 and on/off-chain composition
docs/GOVERNANCE.md      Neutral change control and stable 1.0 gates
docs/STANDARDS_PROFILE.md  Standards boundaries and roadmap
```

## Status

x424/0.1 is a public pre-alpha candidate protocol, not an IETF standard. HTTP
424 is specified by RFC 4918 for WebDAV dependency failures; clients detect
x424 through `HUMAN-REQUIRED` and the supported payload version, not the status
or reason phrase alone.

The reference release is unaudited. Do not use the in-memory stores or
reference router to protect production access or value. Read
[`docs/SECURITY.md`](docs/SECURITY.md) and report vulnerabilities privately as
described in [`SECURITY.md`](SECURITY.md).

Apache-2.0. See [`LICENSE`](LICENSE).
