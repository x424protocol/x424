# Paid unique-human API

These examples use the current official x402 packages (`@x402/core`,
`@x402/express`, `@x402/fetch`, and a chain scheme) without adding payment
semantics to x424 core.

```bash
pnpm add x424 @x402/core @x402/express @x402/fetch @x402/evm viem redis express
```

- `self-hosted-server.ts` runs the public x424 verifier/router and protected
  resource with Redis.
- `managed-server.ts` changes only the x424 issuer/state configuration; World
  RP signing remains in the adopter backend.
- `client.ts` is the browser/direct flow. It performs one World ceremony, then
  the payment, then sends separate `HUMAN-PROOF` and `PAYMENT-SIGNATURE`
  headers. Remote agents use `createX424AgentClient()` and brokered handoff so
  the resource can verify key possession before returning an `agent_key`
  binding.

Every POST requires an application `Idempotency-Key`; the result-acceptance
store permits the same human result only for that same exact operation. Replace testnet network,
facilitator, recipient, World, key, and origin values before use. These are
integration examples, not a production deployment claim.
