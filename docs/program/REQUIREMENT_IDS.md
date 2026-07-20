# Stable requirement identifiers

Version: `requirement-ids-0.1`
Source of truth for normative text remains [PROTOCOL.md](../PROTOCOL.md).
IDs are stable handles for vectors and reviews.

Coverage: `covered` | `needs_vector` | `non_testable` (with rationale).
`covered` requires a named local test and/or published vector that exercises the
requirement. Local coverage is not external gate approval.

## HTTP and transport

| ID            | Requirement (summary)                                                          | Coverage                                                     |
| ------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| X424-HTTP-001 | Unsatisfied dependency returns 424 with HUMAN-REQUIRED                         | covered — `test/core.test.ts`, middleware                    |
| X424-HTTP-002 | Cache-Control no-store, private on challenges/results                          | covered — `test/core.test.ts`                                |
| X424-HTTP-003 | Vary includes HUMAN-PROOF on 424                                               | covered — `test/core.test.ts`                                |
| X424-HTTP-004 | Content-Type application/problem+json on 424 body                              | covered — `test/core.test.ts`                                |
| X424-HTTP-005 | Header size capped; invalid base64url/JSON rejected                            | covered — `test/security-regressions.test.ts`, transport     |
| X424-HTTP-006 | Provider-native proofs MUST NOT be placed in HTTP headers                      | covered — `test/core.test.ts`                                |
| X424-HTTP-007 | Identify x424 by valid header or versioned body transport, not status alone    | covered — `test/client.test.ts` ordinary 424                 |
| X424-HTTP-008 | CORS: explicit origins; expose HUMAN-\* headers; credentials documented        | covered — `test/transport.test.ts`                           |
| X424-HTTP-009 | Redirects MUST NOT forward challenges/proofs to unintended origin/audience     | covered — `test/security-regressions.test.ts` redirect suite |
| X424-HTTP-010 | Conservative inline requirement envelope; fail closed above limit              | covered — `test/security-regressions.test.ts` envelope       |
| X424-HTTP-011 | Alternate body transport when inline exceeds envelope (versioned, no conflict) | covered — body mode; `reference` unsupported in 0.1          |

## Requirement and digest

| ID           | Requirement (summary)                                                          | Coverage                                              |
| ------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| X424-REQ-001 | dependencyId and nonce unpredictable and unique in verifier namespace          | needs_vector                                          |
| X424-REQ-002 | purpose stable application semantics                                           | non_testable — semantic policy                        |
| X424-REQ-003 | requestDigest covers method, uri, body digest                                  | covered — `test/core.test.ts`, conformance            |
| X424-REQ-004 | audience identifies accepting resource server                                  | covered — middleware audience substitution            |
| X424-REQ-005 | expiresAt later than createdAt; ref profile 30–900s                            | covered — conformance + requirements                  |
| X424-REQ-006 | At least one exact method listed                                               | covered                                               |
| X424-REQ-007 | providerRequests created by trusted RP backend when signing involved           | needs_vector                                          |
| X424-REQ-008 | Requirements integrity-protected in production (TLS; signed outer RECOMMENDED) | needs_vector                                          |
| X424-REQ-009 | Absent body → bodyDigest null; present JSON → sha256(canonical-json)           | covered — `test/transport.test.ts`                    |
| X424-REQ-010 | Non-JSON / empty / binary / multipart digest profile (see ADR)                 | covered — `test/security-regressions.test.ts` digests |
| X424-REQ-011 | Streams and non-cloneable bodies: client fail-closed or explicit digest mode   | covered — stream without precompute                   |
| X424-REQ-012 | Idempotency-Key SHOULD be required for mutations                               | covered — `test/middleware.test.ts`                   |

## Methods and binding

| ID            | Requirement (summary)                                     | Coverage                                  |
| ------------- | --------------------------------------------------------- | ----------------------------------------- |
| X424-MTH-001  | Exact provider/method/descriptor; no aliases              | covered                                   |
| X424-MTH-002  | Unknown/disabled/stale/wrong-scope/mode fail closed       | covered — conformance negatives           |
| X424-MTH-003  | No silent claim strengthening or cross-method equivalence | covered                                   |
| X424-BIND-001 | Binding kinds request\|wallet\|agent_key\|session         | covered                                   |
| X424-BIND-002 | Binding values MUST NOT be bearer secrets                 | non_testable — operational                |
| X424-BIND-003 | Adapter MUST verify native proof bound to expected value  | covered (World)                           |
| X424-BIND-004 | Copying binding from client JSON is not verification      | covered — middleware binding substitution |

## Verifier and result

| ID           | Requirement (summary)                                         | Coverage                                   |
| ------------ | ------------------------------------------------------------- | ------------------------------------------ |
| X424-VER-001 | Load server-issued requirement before verify                  | covered                                    |
| X424-VER-002 | Atomically consume nonce before external verification         | covered                                    |
| X424-VER-003 | Pass nativeProof only to selected adapter                     | covered                                    |
| X424-VER-004 | Preserve exact claim/scope/assurance/mode                     | covered                                    |
| X424-VER-005 | Derive audience-pairwise human ID privately                   | covered                                    |
| X424-VER-006 | Failure after nonce consumption requires new dependency       | covered                                    |
| X424-RES-001 | Result MUST NOT contain raw proofs/nullifiers/stable subjects | covered                                    |
| X424-RES-002 | Result token EdDSA x424-result+jws; trust key by kid          | covered                                    |
| X424-RES-003 | Never accept key presented alongside its token                | covered — metadata/token verification path |
| X424-RES-004 | Result window bounded by original dependency                  | covered                                    |

## Replay and privacy

| ID              | Requirement (summary)                                                 | Coverage                                     |
| --------------- | --------------------------------------------------------------------- | -------------------------------------------- |
| X424-REPLAY-001 | Four separate replay controls (provider, subject, dependency, result) | covered                                      |
| X424-REPLAY-002 | Result consumption does not replace app idempotency                   | covered — middleware + concurrent accept     |
| X424-PRIV-001   | Raw proofs/nullifiers never in logs/traces/analytics/queues/results   | covered — redaction + API privacy regression |
| X424-PRIV-002   | Pairwise IDs differ across audiences and methods                      | covered                                      |
| X424-PRIV-003   | Error bodies MUST NOT echo proofs/nullifiers/secrets/diagnostics      | covered — `test/api.test.ts`, redaction      |

## Versioning and conformance

| ID              | Requirement (summary)                           | Coverage                                      |
| --------------- | ----------------------------------------------- | --------------------------------------------- |
| X424-VERNEG-001 | Breaking changes require new x424 version       | non_testable — process                        |
| X424-VERNEG-002 | Unknown critical extensions fail closed         | needs_vector                                  |
| X424-VERNEG-003 | Algorithm allowlist; reject confusion           | covered — result-token / encoding regressions |
| X424-VERNEG-004 | Downgrade / unsupported version rejected        | needs_vector                                  |
| X424-CONF-001   | 0.1 claim requires published vectors pass       | covered                                       |
| X424-CONF-002   | Adapter needs native positive/negative fixtures | covered (World partial)                       |
