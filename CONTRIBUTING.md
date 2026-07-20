# Contributing to x424

x424 is dependency infrastructure, not a generic identity stack. Contributions
should make unique-human requirements more exact, portable, private, or
fail-closed.

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
