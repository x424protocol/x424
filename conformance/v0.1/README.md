# x424/0.1 conformance

`vectors.json` fixes canonical payloads, header encodings, and negative result
mutations for independent implementations.

A conforming implementation must:

1. parse `requirement` and `result` with no unknown fields;
2. reproduce `humanRequired` and `humanResult` byte-for-byte from canonical
   JSON and unpadded base64url encoding;
3. reproduce the fixed request digest;
4. accept the unmodified result at `evaluationTime` using `methodDescriptor`;
5. reject every provider, request, binding, purpose, descriptor, assurance,
   scope, mode, claim, and lifetime mutation with every listed failure code;
   and
6. reject the valid result as expired at `expiredEvaluationTime`.

Passing these vectors proves x424 wire compatibility only. Provider adapters
also require provider-native positive and negative fixtures, binding tests,
replay tests, privacy review, and operational security review.
