# Standards profile

> Snapshot: 2026-07-19

x424 owns unique-human dependency semantics and reuses existing standards for
everything else.

| Concern                    | Reuse                                                        | x424-owned decision                                             |
| -------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| HTTP dependency            | HTTP semantics; status 424 history in RFC 4918               | headers and unique-human requirement/result payloads            |
| Generic credential request | x401, OpenID4VP, DCQL                                        | whether an exact credential method proves acceptable uniqueness |
| Provider proof             | World ID/native protocol, VC, SD-JWT, mdoc, or future method | immutable method descriptor and non-strengthening mapping       |
| Provider trust/discovery   | HTTPS metadata, OpenID Federation, governed registries       | relying-party allowlist of exact method versions                |
| Subject/account binding    | OAuth/OIDC/SIWE/DID/key fingerprints                         | binding result to exact caller and request                      |
| Result signature           | Ed25519/JWS profile                                          | minimal pairwise HumanResult claim set                          |
| Chain/account IDs          | CAIP-2 and CAIP-10 where applicable                          | no canonical chain; exact mode/finality acceptance              |
| Payment                    | x402                                                         | deterministic composition order only                            |
| Agent delegation           | GNAP, AP2, UCAN, application capabilities                    | no delegation inferred from human proof                         |
| Authorization              | AuthZEN or application-native policy                         | verification result is context, never final allow/deny          |
| Lifecycle signals          | provider status, OpenID Shared Signals where available       | fail-closed freshness/revocation mapping                        |

## Own

x424 defines only:

1. `HUMAN-REQUIRED`, `HUMAN-PROOF`, and `HUMAN-RESULT` HTTP behavior.
2. Exact provider/method/version/assurance/scope/mode acceptance.
3. Unique-human request, audience, purpose, caller, nonce, and time binding.
4. Pairwise result identifiers and provider-native privacy boundary.
5. Challenge/result replay semantics.
6. Adapter method descriptors and negative conformance.

## Do not own

x424 will not create a credential format, DID method, identity wallet, biometric
system, universal subject registry, trust network, blockchain, payment rail,
agent directory, mandate token, reputation score, or application authorization
language.

## Compatibility requirements

- HTTP libraries must preserve headers and avoid intermediary caching.
- Cross-language implementations must pass canonical byte/digest vectors.
- A credential carried through x401/OpenID4VP still needs an x424 method
  descriptor before it can satisfy unique-human policy.
- A chain receipt must identify provider/method/scope and cannot become a
  generic on-chain “human” boolean.
- A result used with x402 remains a separate signed object; combining signatures
  is an optional outer application envelope, not a semantic merge.
- Provider assurance labels must never be compared numerically across providers
  unless a separate governed framework explicitly defines that mapping.

## Candidate future standards work

Before a stable 1.0 profile:

- adopt or publish a formal canonicalization profile;
- define authenticated verifier/method metadata and key rotation, preferably
  using an established federation mechanism;
- prove the published JSON Schemas and positive/negative vectors in at least
  one independent implementation language;
- define HTTP structured discovery for routes that may require x424;
- register media/header parameters if the ecosystem reaches interoperability;
  and
- seek independent review before any IETF or other standards submission.

## Adoption evidence

Protocol completeness is necessary but insufficient. Standards claims require
independent evidence that adopters do not reimplement the protected semantics.
The [adopter contract](ADOPTER_CONTRACT.md) defines that boundary, and the
[roadmap](ROADMAP.md) defines the release and interoperability gates.
