# Landscape and prior art

> Research snapshot: 2026-07-19. This is technical/product research, not
> trademark, patent, freedom-to-operate, or legal advice.

## Verdict

x424 is not the first proof-of-personhood system, identity protocol,
multi-provider verification API, agent identity scheme, credential challenge,
or multichain attestation system. Those fields are established and crowded.

The research did not find a public protocol using the x424 name for this exact
job or an implemented HTTP extension with this complete combination:

1. status-code-native challenge for a unique-human dependency;
2. explicit provider/method/version and non-equivalence rules;
3. exact uniqueness-scope semantics rather than a generic “verified” boolean;
4. request/audience and wallet/agent-key binding;
5. pairwise result IDs that hide provider nullifiers;
6. provider/backend/off-chain/on-chain/hybrid execution without one canonical
   chain; and
7. direct composition in front of x402 without becoming payment or agent
   authorization.

That makes x424 a credible new protocol category and pioneer attempt. It does
not justify an absolute “world's first” claim, because differently named,
private, unpublished, or newly launched work may overlap.

The accurate launch claim is:

> x424 is an open HTTP-native protocol for making an action depend on an
> explicitly accepted unique human—across users, agents, providers, backends,
> and chains—without exposing provider identity or treating providers as
> equivalent.

## Name and namespace checks

Checks performed on 2026-07-19:

- GitHub repository search for `x424` found only unrelated names such as
  `x4247`, a course repository, and a personal page; no human/identity protocol.
- npm returned `404 Not Found` for package `x424`.
- Earlier exact web searches found no active `x424 protocol` collision.
- `x424.com` appeared registered; `.org`, GitHub organization, and other
  namespaces require confirmation immediately before public launch.

Search absence is not clearance. Before publication, repeat GitHub/npm/domain,
trademark, package, social handle, and major app-store searches with counsel as
appropriate.

## Historical rationale

[RFC 2518](https://datatracker.ietf.org/doc/html/rfc2518), published in February
1999, introduced `424 Failed Dependency` for WebDAV. It was obsoleted by
[RFC 4918](https://www.rfc-editor.org/rfc/rfc4918), which retains the code.
The number therefore has a real late-1990s HTTP lineage: the action failed
because a prerequisite action failed.

x424 modernizes that idea for the agent era: the unsatisfied prerequisite is
one unique human. The name also parallels x402 while remaining semantically
honest. The caveat is important: RFC 4918 specifies WebDAV usage, so x424 is an
extension profile, not a dormant general-purpose code being “activated” in the
same way x402 describes 402.

## Closest HTTP protocols

### x402

[x402](https://github.com/x402-foundation/x402) standardizes HTTP-native payment
using `402 Payment Required` and the `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`,
and `PAYMENT-RESPONSE` headers. Its current v2 design separates resource
servers, clients, schemes, networks, and facilitators.

Learning for x424:

- use a three-header lifecycle;
- keep the core small and move provider-specific logic into adapters/schemes;
- bind payloads to exact resources;
- support agents without requiring accounts; and
- treat extensions and composition as first-class.

Difference: x402 proves payment authorization/settlement, not unique humanity.
x424 should execute first when an invalid human must not be charged.

### x401

[x401](https://www.x401.id/) is an emerging generic HTTP proof-requirement
protocol. It returns 401 plus proof requirements and uses established
presentation/query standards such as OpenID4VP and DCQL.

Learning for x424:

- reuse credential presentation standards;
- bind challenges and caller/agent identity;
- do not invent another credential wallet; and
- make token exchange optional and scoped.

Difference: generic credential satisfaction does not itself define one-person
uniqueness, nullifier/pseudonym scope, provider substitution, recovery, or
human-to-agent dependency semantics. x424 is a narrower semantic dependency and
can use x401 internally or alongside it.

## Proof-of-personhood providers

### World ID

[World ID](https://whitepaper.world.org/proof-of-personhood) is the first x424
provider and the clearest production example of privacy-preserving unique-human
proof. Current [World developer documentation](https://docs.world.org/world-id/idkit/integrate)
requires backend RP request signing, IDKit 4.x, backend verification at
`/api/v4/verify/{rp_id}`, and relying-party nullifier handling. The
[World ID 4 migration guide](https://docs.world.org/world-id/4-0-migration)
distinguishes one-time uniqueness nullifiers from `session_id` continuity.

x424 adds no biometric or World cryptography. It standardizes how a relying
party asks for the exact World method, binds it to a user/agent request, hides
the provider nullifier, and composes the result with non-World systems.

### World AgentKit

[World's MIT-licensed AgentKit repository at commit
`3775f076cb15fe9783353413bd6860c94f8bdeeb`](https://github.com/worldcoin/agentkit/tree/3775f076cb15fe9783353413bd6860c94f8bdeeb)
is credited prior art, not an x424 dependency or implementation template.

> World’s AgentKit demonstrated a practical World ID-backed agent registration
> and request-signing flow. Its terminal human handoff, wallet-possession, and
> agent HTTP patterns informed x424’s agent-surface requirements. x424 addresses
> a different layer: a provider-neutral HTTP dependency protocol that preserves
> each provider’s exact claim, scope, lifecycle, and privacy boundary.

x424 does not copy AgentKit code, documentation text, API layout, QR assets, or
skill wording. Core CI and runtime contain no AgentKit package or network
dependency. A future AgentKit/AgentBook provider method would describe
historical enrollment plus current wallet possession rather than fresh World
verification, and remains deferred until a separately versioned profile can
state atomic replay, revocation, rotation, recovery, and lifecycle semantics.

### Humanity Protocol

[Humanity Protocol](https://www.humanity.org/protocol) describes a
privacy-preserving Proof of Humanity/Trust system using palm biometrics,
zero-knowledge proofs, credentials, and its own network. It is evidence that
future x424 providers may have different assurance, scope, state, and recovery
semantics; those must be explicit rather than mapped to `world:...`.

### BrightID

[BrightID](https://www.brightid.org/) uses a privacy-oriented social graph to
provide application-specific proof of uniqueness/fair access. Its trust model
differs fundamentally from biometric deduplication, reinforcing x424's rule
that provider alternatives are accepted branches, not equivalent proofs.

### Human Passport and aggregators

[Human Passport](https://passport.human.tech/) aggregates credentials/signals
for proof-of-personhood and Sybil resistance. Commercial and emerging
aggregators already offer “many identity providers through one API.” Connector
count is therefore not x424's novelty. An aggregator can become one x424
provider method only if it publishes exact score/threshold, scope, lifecycle,
and non-claim semantics.

### Academic personhood credentials

The paper [Personhood credentials](https://arxiv.org/abs/2408.07892) analyzes
privacy-preserving credentials that let people distinguish themselves from AI
without disclosing identity. Earlier work includes
[UniqueID](https://arxiv.org/abs/1806.07583) and research on pseudonym parties.
These establish that the unique-human problem predates x424 and has multiple
valid trust approaches.

## Credential, trust, and authorization standards

x424 should adopt, profile, or bridge rather than compete with:

- [W3C Verifiable Credentials 2.0](https://www.w3.org/TR/vc-data-model/);
- [SD-JWT](https://www.rfc-editor.org/rfc/rfc9901.html);
- [OpenID4VP](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html)
  and DCQL;
- [OpenID Federation](https://openid.net/specs/openid-federation-1_0-final.html);
- [OpenID Shared Signals](https://openid.net/three-shared-signals-final-specifications-approved/);
- [CAIP-2/CAIP-10](https://chainagnostic.org/) for chain/account references;
- [GNAP](https://www.rfc-editor.org/rfc/rfc9635.html), AP2, and UCAN for
  delegation/mandates; and
- [AuthZEN](https://openid.net/specs/authorization-api-1_0.html) or local policy
  for final authorization.

The standards boundary is the product discipline: x424 owns the dependency
semantics and negative conformance, not the whole identity stack.

## Agent identity and human relationships

SPIFFE, AGNTCY Identity, A2A identities, DIDs, workload credentials, wallet
signatures, and API keys identify machines or keys. AP2/GNAP/UCAN-style systems
describe authority. None should be rebranded as proof that the machine is
human.

x424 contributes a smaller primitive: a human can satisfy one dependency bound
to an agent key without giving the agent the provider nullifier or a broad
human bearer credential. Durable ownership and delegation remain separate.

## On-chain and multichain systems

World ID contracts, EAS, Sign Protocol, Verax, and native registries can verify
or store attestations across chains. They are execution/state substrates, not
universal semantic equivalence layers. x424's chain-neutral contribution is to
hold the provider/method/scope/binding constant while allowing a relying party
to select backend, on-chain, off-chain, or hybrid verification explicitly.

## What is genuinely distinctive

The strongest protocol contribution is not a token or connector marketplace.
It is:

1. **Exact human method descriptors:** claim, non-claims, uniqueness scope,
   recovery, privacy, binding, replay, and execution.
2. **HTTP-native agent flow:** a machine can detect, escalate, and retry a human
   dependency without learning stable human identity.
3. **No implicit equivalence:** provider alternatives are explicit policy.
4. **Pairwise signed results:** portable across API/MCP/gateway surfaces while
   remaining request-bound and short-lived.
5. **Conformance:** public negative vectors for substitution, leakage, replay,
   downgrade, and cross-chain semantic drift.
6. **Composition:** x424 precedes x402 and coexists with x401/authorization.

## Claims to avoid

- “first proof of humanity/personhood”;
- “first multi-provider verification API”;
- “first universal identity”;
- “one verification works everywhere”;
- “all human-verification providers are interchangeable”;
- “first human-agent identity”;
- “verified agents are humans”; or
- “IETF/HTTP standard” before standards adoption.

## Claims supportable now

- “an open pre-alpha HTTP-native unique-human dependency protocol”;
- “World ID Orb as the first provider behind a provider-neutral contract”;
- “exact provider alternatives without a universal verification score”;
- “human results bound to users, wallets, sessions, or agent keys”; and
- “designed to compose before x402 across backend and chain deployments.”

Stronger pioneer/adoption claims require a public repo, independent review,
another conforming implementation, at least one additional provider, and more
than one relying party.

## Research limits

- The identity and agent-protocol landscape changes quickly.
- GitHub/npm/search snapshots can miss private, renamed, unindexed, or newly
  published work.
- Marketing claims were treated as system descriptions, not independent
  security validation.
- No patent, academic-citation, standards-IPR, or jurisdictional biometric-law
  review was completed.
- Provider integrations require separate legal, privacy, and threat review.
