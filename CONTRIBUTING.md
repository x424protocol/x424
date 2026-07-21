# Contributing to x424

x424 is dependency infrastructure, not a generic identity stack. Contributions
should make unique-human requirements more exact, portable, private, or
fail-closed.

## Ways to contribute

You do not need protocol, identity, or cryptography expertise to help. Useful
first contributions include:

- run the [ten-minute quickstart](docs/QUICKSTART.md) and report where it was
  confusing, slow, or surprising;
- improve an example, error message, or framework integration;
- review the HTTP or OpenAPI contract as an API consumer;
- implement a small decoder against the fixed conformance vectors;
- add platform coverage for an environment you use; or
- help turn a provider proposal into explicit claims, non-claims, and negative
  fixtures.

Look for [`good first issue`](https://github.com/x424protocol/x424/labels/good%20first%20issue)
or [`help wanted`](https://github.com/x424protocol/x424/labels/help%20wanted).
If an issue looks too large, comment with the part you want to attempt and a
maintainer will help make the boundary smaller. A report that only identifies
friction is a useful contribution; you do not have to arrive with a fix.

Maintainers aim to acknowledge new contributor issues and pull requests within
three working days. If that does not happen, a polite follow-up is welcome.

## Your first pull request

1. Comment on an issue or open a small proposal so work is not duplicated.
2. Fork the repository and create a focused branch.
3. Run `pnpm install` and `pnpm check`.
4. Make the smallest change that satisfies the issue's definition of done.
5. Open a pull request and mention the issue it addresses.

Draft pull requests are welcome when you want early feedback. Maintainers will
help with protocol-specific tests and documentation when the contribution is
otherwise well scoped.

## Development

```bash
pnpm install
pnpm check
```

Use conventional commits. Update protocol/security documentation and negative
tests whenever acceptance semantics change.

Protocol changes follow [`docs/GOVERNANCE.md`](docs/GOVERNANCE.md). Every
proposal must state compatibility and security impact; unresolved semantic
ambiguity fails closed.

Use the protocol-change or provider-profile issue form before proposing a new
wire semantic or identity method. Adoption work must preserve the boundary in
[`docs/ADOPTER_CONTRACT.md`](docs/ADOPTER_CONTRACT.md): adopter policy belongs
to the adopter; reusable verification mechanics belong in x424.

## Provider adapters

Every adapter proposal must include:

- exact positive claim and explicit non-claims;
- provider, method, and immutable descriptor versions;
- uniqueness/pseudonym scope and collision assumptions;
- assurance labels interpreted only inside that provider;
- request, subject, wallet, or agent-key binding;
- nonce, replay, freshness, expiry, status, and revocation behavior;
- recovery/rotation effects on uniqueness and continuity;
- supported backend/off-chain/on-chain/hybrid verification modes;
- retention, deletion, residency, privacy, and cross-RP linkability;
- positive and negative conformance fixtures; and
- provider trademark/disclosure constraints.

Adding an adapter does not make it equivalent to another adapter and does not
add it to any relying-party policy.

## Pull requests

- Never include real proofs, nullifiers, relying-party signing keys, API keys,
  private subjects, production data, or adopter-specific implementation
  details.
- Keep raw provider material inside the adapter boundary.
- Add provider/method/scope/binding/replay substitution tests.
- Preserve MCP, OpenAPI, HTTP, and TypeScript contract parity.
- Explain compatibility and migration impact for every wire change.
