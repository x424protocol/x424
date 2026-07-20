# x424

[![CI](https://github.com/x424protocol/x424/actions/workflows/ci.yml/badge.svg)](https://github.com/x424protocol/x424/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

> Human Dependency Protocol · public pre-alpha · unaudited

**x424 is an open HTTP protocol for making one request depend on one explicitly
accepted unique human.** It works across users, agents, wallets, backends, and
APIs without turning any provider into a universal identity authority.

[Protocol](docs/PROTOCOL.md) · [Adoption contract](docs/ADOPTER_CONTRACT.md) ·
[Roadmap](docs/ROADMAP.md) · [OpenAPI](openapi/x424.openapi.json) ·
[Conformance](conformance/v0.1/README.md) · [Governance](docs/GOVERNANCE.md)

## Why x424

Unique-human providers prove different things, but every application currently
rebuilds the same dependency machinery: challenge discovery, request binding,
provider handoff, verifier submission, replay prevention, result validation,
and retry.

x424 standardizes that machinery. A resource names the exact provider methods
it accepts. A human completes one method. A verifier returns a short-lived
result bound to the request and caller. The client retries with that result.

When a service also requires payment, the layers stay independent:

```text
authentication -> x424 -> x402 -> authorization -> execution
```

x424 standardizes the dependency, not the underlying proof system. It does not
define a human identity, equate providers, create an account, or authorize the
application action.

## Adoption promise

For a supported provider, an adopter should supply only:

- provider credentials and environment;
- accepted methods and freshness policy;
- the authenticated wallet, session, request, or agent-key binding;
- provider UI appropriate to its platform; and
- application authorization and idempotency.

x424 should own the wire protocol, signed provider request construction, proof
submission, strict verification, privacy boundary, replay controls, result
signing, and client retry. The measurable boundary is defined in the
[adopter contract](docs/ADOPTER_CONTRACT.md).

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

The retry carries the verifier result, never a raw provider proof:

```http
POST /action HTTP/1.1
HUMAN-PROOF: <x424-result+jws>
Idempotency-Key: <application-key-for-mutations>
```

## Current status

x424/0.1 is a developer preview, not a production security product or an IETF
standard. The repository now includes:

- canonical requirement/result codecs and request digests;
- exact audience, purpose, time, request, and caller binding;
- Ed25519 signed results and pairwise human identifiers;
- atomic-store interfaces plus Redis-backed requirement, dependency,
  provider-subject, and result replay state;
- a provider-adapter SDK and fixed negative conformance vectors;
- a reusable World verifier profile with signed RP requests, built-in signal
  binding, and an explicit legacy Orb fallback method;
- a generic HTTP verifier resolver and one-challenge/one-retry client;
- an Express verifier router, OpenAPI 3.1, JSON Schemas, and MCP server; and
- a no-build dependency console.

It does **not** yet include an audited deployable verifier, managed key custody,
authenticated verifier metadata, production authorization/rate-limit policy,
or an independent implementation. Follow the concrete release gates in the
[roadmap](docs/ROADMAP.md).

## Try the developer preview

The first npm release has not been published. Run the current source directly:

```bash
git clone https://github.com/x424protocol/x424.git
cd x424
corepack enable
pnpm install
pnpm check
pnpm example
```

After the first release, the supported install command will be:

```bash
pnpm add x424
```

The repository requires Node.js 22+ and pnpm 9+.

## Package surfaces

The package keeps the provider-neutral kernel separate from integrations:

```ts
import { createHumanRequirement } from "x424/core";
import { createHttpHumanDependencyResolver, fetchWithX424 } from "x424/client";
import { defineHumanProviderAdapter } from "x424/adapters";
import {
  WorldIdAdapter,
  createWorldIdMethodRequirements,
  createWorldIdVerifierProfile,
} from "x424/providers/world-id";
import {
  createWorldIdIdKitProofResolver,
  createWorldIdProofRequest,
} from "x424/providers/world-id/client";
import { RedisX424Store } from "x424/redis";
import { createX424HttpRouter } from "x424/express";
import { createX424McpServer } from "x424/mcp";
```

## World Proof of Human profile

The World profile uses one `proofOfHuman` ceremony. It generates the RP
signature on the trusted backend, uses the x424 binding as the World signal,
forwards the IDKit result without reshaping it, and accepts only a matching
World verification result.

Create the reusable profile once:

```ts
import { createWorldIdVerifierProfile } from "x424/providers/world-id";

const world = createWorldIdVerifierProfile({
  appId: process.env.WORLD_APP_ID!,
  rpId: process.env.WORLD_RP_ID!,
  signingKeyHex: process.env.WORLD_RP_SIGNING_KEY!,
  action: "publish-record",
  environment: "production",
  allowLegacyProofs: true,
});

// world.catalog and world.adapter configure X424Service.
// world.accepts and world.providerRequests configure requirement issuance.
```

The signing key never enters `providerRequests`. With legacy enabled, IDKit may
complete the same ceremony with either `world:proof-of-human@1` (v4) or
`world:orb-legacy@1` (v3). The resolver labels the actual outcome before proof
submission, and the signed x424 result preserves that exact method. A client
cannot enable fallback unless the requirement, signed provider request, and
verifier profile all allow it.

The two methods deliberately produce different pairwise IDs and do not claim
cross-version deduplication. Applications that accept both for one long-lived
participation namespace must retain their existing cross-version policy. x424
does not pretend that different World nullifiers identify the same person.

World uniqueness is scoped to the RP and registered World action—not to the
x424 dependency ID or signal. Reusing one World action therefore means one
successful participation per human in that action, not one proof per HTTP
request. Choose actions as real uniqueness domains.

## Shared verifier state

The Express router accepts a shared `RequirementStore`. The Redis runtime
provides requirement, dependency nonce, provider replay, and result stores
through one configured client:

```ts
import { createClient } from "redis";
import { RedisX424Store } from "x424/redis";

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const state = new RedisX424Store({ client: redis });

// X424Service({
//   nonceStore: state.nonces,
//   providerReplayStore: state.providers,
//   ...
// })
// createX424HttpRouter({ requirementStore: state.requirements, ... })
// verifyHumanProofHeader({ replayStore: state.results, ... })
```

Redis 6.2+ supplies atomic state; the operator still owns topology, access
control, monitoring, backup, and failure testing.

## Client composition

Applications decide how to display or deep-link the provider's connector URI.
x424 builds the IDKit request, collects its exact result, submits it to the
verifier, extracts the signed result, and retries the original request:

```ts
import { createHttpHumanDependencyResolver, fetchWithX424 } from "x424/client";
import { createWorldIdIdKitProofResolver } from "x424/providers/world-id/client";

const resolveHumanDependency = createHttpHumanDependencyResolver({
  verifierUrl: "https://verifier.example.com/",
  resolveProviderProof: createWorldIdIdKitProofResolver({
    onConnectorUri: ({ connectorUri }) => renderQrOrDeepLink(connectorUri),
  }),
});

const response = await fetchWithX424(url, requestInit, {
  resolveHumanDependency,
});
```

The helper retries only when both status `424` and a valid `HUMAN-REQUIRED`
header are present. It never chooses an unlisted provider or treats ordinary
dependency failures as x424.

## Accept the retried request

```ts
import { defineMethodCatalog, verifyHumanProofHeader } from "x424/core";

const result = await verifyHumanProofHeader({
  humanProof: request.headers["human-proof"],
  requirement: storedRequirement,
  verifier: trustedVerifierPublicKey,
  catalog: defineMethodCatalog(acceptedMethodDescriptors),
  replayStore: sharedAtomicResultStore,
});

// x424 is satisfied. The application still authorizes and executes
// idempotently.
```

For mutations, consume `resultId` atomically and use the application's normal
idempotency mechanism. x424 prevents human-result reuse; it does not prevent
duplicate business execution by itself.

## Provider adapters

Provider integrations use the public adapter contract without changing core:

```ts
import {
  defineHumanMethodDescriptor,
  defineHumanProviderAdapter,
} from "x424/adapters";

const method = defineHumanMethodDescriptor({
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
  methods: [method],
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

Every adapter documents exact claims, non-claims, scope, binding, replay,
recovery, privacy, and execution mode. Installing an adapter never adds it to a
relying-party policy.

## Providers are not interchangeable

x424 does not create a universal human identifier or deduplicate subjects
across providers. A proof from provider A and a proof from provider B may
belong to the same person. A one-person policy that accepts both providers
needs an explicit cross-provider duplicate-participation policy.

Provider alternatives are named trust branches, never an implicit score or
equivalence claim.

## Agents and humans

x424 can bind a result to an agent public-key fingerprint for one request or
narrow purpose. It does not label the agent as human or prove ownership,
delegation, competence, authority, or continued control. Durable human-agent
relationships belong in a separate consent, mandate, recovery, and revocation
system.

## Repository map

```text
src/                     Core, provider profiles, Redis state, HTTP, and MCP
schemas/                 JSON Schema 2020-12 wire contracts
conformance/             Fixed cross-implementation vectors
openapi/                 OpenAPI 3.1 verifier contract
demo/                    Provider-safe dependency console
examples/                Generic HTTP and provider-adapter examples
test/                    Core, security, provider, Redis, and contract tests
docs/PROTOCOL.md          Normative x424/0.1 contract
docs/ADOPTER_CONTRACT.md  Off-the-shelf responsibility boundary
docs/ROADMAP.md           Release and standards-readiness gates
docs/SECURITY.md          Threat model and production controls
docs/GOVERNANCE.md        Neutral change control and stable 1.0 gates
```

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Protocol changes must state security
and compatibility impact and update negative vectors. Provider contributions
must include provider-native positive and negative fixtures.

## Security and license

The reference release is unaudited. Do not use in-memory stores or the
reference router alone to protect production access or value. Read
[docs/SECURITY.md](docs/SECURITY.md) and report vulnerabilities through
[SECURITY.md](SECURITY.md).

Apache-2.0. See [LICENSE](LICENSE).
