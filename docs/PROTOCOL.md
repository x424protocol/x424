# x424/0.1 protocol contract

> Status: public pre-alpha draft. Normative words describe the intended
> contract; x424 is not an IETF standard.

## 1. Purpose

x424 lets an HTTP resource declare that executing one request depends on one
explicitly accepted unique-human proof. It defines:

- how a resource server challenges a user or agent;
- how exact accepted human-verification methods are named;
- how a provider-native proof is exchanged at a verifier boundary;
- how the verifier returns a minimal, signed, pairwise result; and
- how the resource server binds and consumes that result.

x424 does not define provider proof cryptography, a credential format, a human
identity, a wallet, generic authorization, payment, reputation, or legal KYC.

## 2. HTTP status and headers

An unsatisfied dependency returns:

```http
HTTP/1.1 424 Failed Dependency
HUMAN-REQUIRED: <base64url-canonical-json HumanRequirement>
Cache-Control: no-store, private
Vary: HUMAN-PROOF
Content-Type: application/problem+json
```

Headers are case-insensitive per HTTP. Canonical display names are:

| Header           | Direction                | Value                                                      |
| ---------------- | ------------------------ | ---------------------------------------------------------- |
| `HUMAN-REQUIRED` | resource server → client | base64url canonical JSON requirement                       |
| `HUMAN-PROOF`    | client → resource server | compact signed `x424-result+jws` token                     |
| `HUMAN-RESULT`   | verifier → client        | the signed result token issued after provider verification |

Provider-native proofs MUST NOT be placed in an HTTP header. They are submitted
to the verifier endpoint in a body. Implementations MUST cap header size, reject
invalid base64url/JSON, and send `Cache-Control: no-store, private`.

HTTP 424 is standardized for WebDAV dependency failures by RFC 4918. x424 uses
its dependency semantics as an extension for ordinary HTTP resources; it does
not assert WebDAV conformance. A client identifies x424 by the
`HUMAN-REQUIRED` header and supported payload version, not status alone.

## 3. HumanRequirement

```ts
interface HumanRequirement {
  x424Version: "0.1";
  dependencyId: string;
  purpose: string;
  resource: {
    method: string;
    uri: string;
    audience: string;
    requestDigest: string;
  };
  nonce: string;
  binding: HumanBinding;
  createdAt: string;
  expiresAt: string;
  accepts: HumanMethodRequirement[];
  providerRequests?: Record<string, unknown>;
}
```

Rules:

1. `dependencyId` and `nonce` MUST be unpredictable and unique inside the
   verifier namespace.
2. `purpose` MUST be stable application semantics, not display copy.
3. `resource.method`, canonical absolute `uri`, and body digest MUST be covered
   by `requestDigest`.
4. `audience` MUST identify the accepting resource server.
5. `expiresAt` MUST be later than `createdAt`; the reference profile permits
   30–900 seconds.
6. At least one exact method MUST be listed.
7. `providerRequests` contains opaque provider-native request material keyed by
   `providerId:methodId`. It MUST be created by the trusted relying-party
   backend when provider signing keys are involved.
8. Requirements MUST be integrity protected in production. TLS is mandatory;
   a signed outer requirement is RECOMMENDED when the resource server and
   verifier are separate authorities.

### 3.1 Request digest

x424/0.1 reference canonicalization computes:

```text
bodyDigest = body absent ? null : sha256(canonical-json(body))
requestDigest = sha256(canonical-json({ uppercase method, uri, bodyDigest }))
```

The TypeScript reference uses lexicographically sorted JSON object keys and
base64url SHA-256 digests prefixed `sha256:`. This is an implementation profile,
not a claim of RFC 8785 conformance. A future protocol version may adopt a
formal cross-language canonicalization profile; independent implementations
MUST match the published x424 vectors before claiming 0.1 interoperability.

## 4. Exact method requirement

```ts
interface HumanMethodRequirement {
  providerId: string;
  methodId: string;
  descriptorVersion: string;
  assuranceLevel?: string;
  acceptedScopeKinds: ("global" | "relying_party" | "action" | "session")[];
  maximumProofAgeSeconds?: number;
  verificationModes?: ("backend" | "offchain" | "onchain" | "hybrid")[];
}
```

Every field is an acceptance boundary:

- `providerId` and `methodId` use lowercase protocol identifier syntax:
  `[a-z0-9][a-z0-9._-]{0,99}`.
- Provider and method aliases are prohibited.
- Descriptor versions are immutable.
- Assurance labels have meaning only inside one provider method.
- Uniqueness scopes are not ordered and cannot be widened by inference.
- Verification modes are mechanisms, not universal strength levels.
- Alternatives mean “the relying party accepts any named branch,” not “the
  providers make the same claim.”

Unknown, disabled, omitted, stale, wrong-scope, or wrong-mode methods fail
closed. Adding a provider requires a new relying-party policy/requirement.

## 5. Human binding

```ts
interface HumanBinding {
  kind: "request" | "wallet" | "agent_key" | "session";
  value: string;
}
```

- `request` binds to an application-defined request-key fingerprint.
- `wallet` binds to an authenticated wallet subject or normalized address.
- `agent_key` binds to a public agent-key fingerprint.
- `session` binds to a sender-constrained application session.

Values MUST NOT be bearer secrets. The provider adapter MUST verify that the
provider-native proof is bound to the expected value or to an application
session that has already proved it. Merely copying the value from client JSON is
not verification.

An `agent_key` result means one accepted human proof was bound to that key for
the named dependency. It does not prove ownership of the agent, ongoing human
control, delegation, competence, or authorization.

## 6. Provider submission

The client sends a `HumanProofSubmission` to the verifier endpoint:

```ts
interface HumanProofSubmission {
  x424Version: "0.1";
  dependencyId: string;
  providerId: string;
  methodId: string;
  binding: HumanBinding;
  nativeProof: unknown;
}
```

The verifier MUST:

1. load the server-issued requirement;
2. validate version, expiry, exact provider/method, and caller binding;
3. atomically consume the requirement nonce before external verification;
4. pass `nativeProof` only to the selected adapter;
5. validate provider cryptography and native request/signal binding;
6. preserve the exact provider claim, scope, assurance, and verification mode;
7. derive an audience-pairwise human ID inside its private boundary; and
8. issue a short-lived signed result.

A verifier failure after nonce consumption requires a new dependency. This
trades retry convenience for an unambiguous one-challenge/one-attempt boundary.

## 7. HumanResult

The result binds:

- protocol and result IDs;
- dependency ID, purpose, and audience;
- exact request digest and caller binding;
- provider, method, descriptor version, and optional provider-local assurance;
- pairwise human ID and exact uniqueness scope;
- verification mode and proof digest;
- exact positive claim and non-claims;
- provider verification, issuance, and expiry times; and
- optional non-secret state references.

It MUST NOT contain raw proofs, provider nullifiers, globally stable provider
subjects, biometric material, recovery data, or unrelated credentials.

The pairwise human ID is derived from a relying-party secret over at least:

```text
audience || providerId || methodId || providerSubject
```

Changing the pairwise secret is an identity migration. Production systems need
versioned keys and an explicit overlap/cutover plan; silent rotation can create
duplicate local humans.

## 8. Result token

The reference token is compact JWS-like serialization:

```text
base64url(canonical header).base64url(canonical HumanResult).base64url(signature)
```

Header:

```json
{ "alg": "EdDSA", "typ": "x424-result+jws", "kid": "..." }
```

The verifier signs with Ed25519. Resource servers MUST select a trusted key by
`kid`, verify the signature, validate every requirement binding, enforce
freshness/expiry, and reject unknown methods. Production key distribution,
rotation, and revocation require authenticated metadata; accepting a public key
supplied alongside its token is prohibited.

## 9. Replay and idempotency

There are four separate replay controls:

1. Provider-native replay: defined by the provider method.
2. Provider-subject replay: when the method requires relying-party retention,
   the verifier atomically retains a private digest of
   `(provider, method, scope, providerSubject)`.
3. Dependency replay: the verifier atomically consumes `(dependencyId, nonce)`.
4. Result replay: a state-changing resource server atomically consumes
   `resultId` until token expiry.

x424 result consumption does not replace application idempotency. Mutations
SHOULD also require an `Idempotency-Key` so a lost success response can be
retried without duplicating the business action. The application must define
whether the same result may cover safe reads, a batch, or exactly one mutation.

## 10. Reference provider profile: World Proof of Human

This profile is non-normative for x424 core. It demonstrates how one concrete
provider method preserves native claims and non-claims without adding provider
fields to the wire protocol.

Identifiers:

- `world:proof-of-human@1` for World ID 4 Proof of Human; and
- `world:orb-legacy@1` for the World ID 3 Orb fallback.

The positive claim is method-specific. The v4 method states that World accepted
Proof of Human for the configured RP and action. The legacy method states that
World accepted a legacy World ID 3 Orb uniqueness proof for that RP/action.
Neither method claims civil identity or equivalence to the other.

Mandatory non-claims include civil identity, demographic attributes,
continuous presence, agent/wallet ownership, broad authorization, and
equivalence to another provider.

Profile rules:

- RP ID uses the current `rp_...` namespace.
- Native signed request material and action are generated on the backend.
- The x424 binding value is the World signal; both branches must contain its
  exact provider hash before the adapter calls the remote verifier.
- The exact IDKit result is forwarded to `POST /api/v4/verify/{rp_id}` without
  proof-field reshaping.
- One IDKit `proofOfHuman` ceremony may resolve to v4 `proof_of_human` or, when
  explicitly enabled, v3 `orb`. The client labels the actual outcome with its
  exact x424 method before submission.
- Legacy is enabled only when the requirement accepts `world:orb-legacy@1`, the
  trusted provider request sets `allowLegacyProofs`, and the verifier profile
  enables it. Native-proof/method substitution fails closed.
- v3 and v4 nullifiers are stored and pairwise-derived under distinct method
  namespaces. The profile makes no cross-version deduplication claim.
- The provider nullifier remains private and is never returned.
- The verifier atomically retains only an HMAC digest of the provider,
  method, scope, and nullifier before issuing a result.
- The method's uniqueness scope is `action` in profile 1.
- The World action, not the x424 dependency ID or signal, defines the native
  one-human participation namespace. Reusing an action does not create fresh
  eligibility for each HTTP request.
- Verification mode is `backend`.
- World session proof continuity is not substituted for uniqueness proof.
- One-time uniqueness nullifiers mean deletion does not necessarily permit a
  fresh proof under the same action. Relying parties must design recovery and
  action rotation deliberately.

## 11. Errors

The reference API uses `application/problem+json`. Stable protocol failure
codes include exact method, descriptor, audience, request, binding, scope,
mode, time, and replay failures. Error bodies MUST NOT echo native proofs,
nullifiers, pairwise derivation inputs, secrets, or provider diagnostics that
enable probing.

## 12. Versioning

Breaking wire, canonicalization, signature, binding, replay, privacy, or
acceptance changes require a new x424 version. Provider descriptor changes use
their own immutable versions. Implementations MUST NOT silently reinterpret an
existing `(providerId, methodId, descriptorVersion)` tuple.

## 13. Conformance

An implementation claiming x424/0.1 compatibility MUST pass the published
canonical encoding, request-digest, valid-result, expiry, provider, request,
binding, purpose, descriptor, assurance, scope, mode, claim, and time-window
vectors in `conformance/v0.1`.

Wire conformance does not certify a provider adapter. Each adapter also needs
provider-native positive and negative fixtures covering proof authenticity,
scope, caller binding, freshness, replay, recovery, privacy, and failure-mode
behavior. Installing an adapter does not add it to relying-party policy.

No adopter, provider, chain, verifier operator, or package implementation has a
privileged role in the x424 protocol namespace.
