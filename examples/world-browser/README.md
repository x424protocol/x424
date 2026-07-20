# World browser → verifier → resource (public APIs only)

This example shows the complete x424/World flow using **only exported package
surfaces**. Legacy Orb is disabled by default.

## Components

| Process              | Role                                          | Public APIs                                     |
| -------------------- | --------------------------------------------- | ----------------------------------------------- |
| `resource-server.ts` | Issues 424 challenges; verifies `HUMAN-PROOF` | `x424/middleware`, `x424/core`                  |
| `verifier-server.ts` | Issues requirements + verifies World proofs   | `x424/express`, World adapter                   |
| Browser page         | Runs IDKit; retries with `HUMAN-PROOF`        | `x424/client`, `x424/providers/world-id/client` |

## Rules demonstrated

- RP request material is generated only on the trusted verifier backend.
- Binding is a server-extracted session subject, not a client-supplied string.
- Only `world:proof-of-human@1` is accepted; legacy remains opt-in elsewhere.
- Raw proofs go to the verifier body only; they never enter resource state.
- Mutations require `Idempotency-Key`.

## Run (local fixtures)

```bash
# Terminal 1 — shared local stack (verifier + resource, shared keys/store)
pnpm exec tsx examples/world-browser/local-stack.ts

# Terminal 2 — scripted client (no real World credentials)
pnpm exec tsx examples/world-browser/scripted-client.ts
```

Role-split sketches (`verifier-server.ts`, `resource-server.ts`) show how the
same public APIs compose when processes are separated; they require shared
requirement state and authenticated verifier metadata for result keys.

Failure fixtures exercised by `scripted-client.ts`:

- wrong binding
- replayed result
- expired requirement
- unaccepted legacy method

This example is **not** a production profile. Use `eval-redis-0.2` or
`prod-ha-0.2` deployment profiles with authenticated issuance before protecting
value.
