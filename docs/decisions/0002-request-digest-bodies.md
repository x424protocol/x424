# ADR-0002: Request digest for non-JSON and non-replayable bodies

- Status: accepted
- Date: 2026-07-19
- Decision makers: Protocol lead (program baseline)
- Requirement IDs: X424-REQ-003, X424-REQ-009..012, X424-REPLAY-002

## Context

PROTOCOL.md defines JSON body digests via canonical JSON. Real HTTP mutations
use empty bodies, multipart, binary, and streams. Lost success responses need
adopter idempotency.

## Alternatives

1. Support JSON only; reject all other bodies at challenge time.
2. Invent a proprietary non-JSON digest profile unrelated to HTTP.
3. **Selected:** Prefer RFC 9530 `Content-Digest` / `sha-256` over raw bytes when
   the body is opaque; keep canonical-JSON digest for JSON object/array bodies;
   empty body → `bodyDigest: null`; non-replayable/streamed bodies require
   explicit precomputed digest or fail closed.

## Decision

`requestDigest = sha256(canonical-json({ method, uri, bodyDigest }))` unchanged.

`bodyDigest` selection:

| Body kind                              | bodyDigest                                               |
| -------------------------------------- | -------------------------------------------------------- |
| Absent / undefined                     | `null`                                                   |
| Empty (`0` octets)                     | `null`                                                   |
| JSON object or array (parsed)          | `sha256(canonicalJson(value))` (existing)                |
| Opaque bytes (Buffer/Uint8Array)       | `sha256:` + base64url(SHA-256(bytes)) — same prefix form |
| String treated as UTF-8 bytes          | opaque-bytes profile                                     |
| Stream / unknown length without digest | **fail closed** — caller must supply `bodyDigest`        |

Multipart and form data are opaque bytes of the exact serialized body that will
be sent. Clients MUST NOT re-serialize differently between challenge and retry.

Mutations SHOULD send `Idempotency-Key`. x424 guarantees dependency/result
single-use only; adopters own exactly-once business execution.

## Security impact

Prevents digest bypass via type confusion; streams cannot silently bind as
empty. Does not weaken binding.

## Privacy impact

Digests are hashes only; raw body content is not stored by x424 core.

## Compatibility and migration

Existing JSON vectors unchanged. New vectors cover empty, opaque, and
fail-closed stream cases. A future version may mandate Content-Digest header
alignment without reinterpreting 0.1 JSON digests.

## Negative vectors / tests

- `digest-empty-body-null`
- `digest-opaque-bytes`
- `digest-stream-without-precompute-fails`
- `idempotency-key-recommended-on-mutation` (middleware)

## Unresolved risks

Cross-language UTF-8 normalization for string-as-bytes needs vector coverage;
prefer Uint8Array in fixtures.
