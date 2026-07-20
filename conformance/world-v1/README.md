# World Proof of Human provider-request vectors

These fixtures lock the managed-verifier validation boundary for
`world:proof-of-human@1`. A conforming World adapter must accept the unchanged
request and reject every mutation before registering the x424 dependency
nonce. Signature authenticity and freshness are still verified by World; these
vectors cover adopter/verifier policy matching, binding, downgrade, and bounded
lifetime.

The key used to create the positive request is a public conformance fixture and
must never be used by an adopter.
