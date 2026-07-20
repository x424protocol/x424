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
- `client.ts` is shared by browser/wallet and agent callers. It performs one
  World ceremony, then the payment, then sends separate `HUMAN-PROOF` and
  `PAYMENT-SIGNATURE` headers.

Every POST requires an application `Idempotency-Key`. Replace testnet network,
facilitator, recipient, World, key, and origin values before use. These are
integration examples, not a production deployment claim.
