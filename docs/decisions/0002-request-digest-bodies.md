# ADR-0002: Request digest for non-JSON and non-replayable bodies

- Status: review-pending
- Date: 2026-07-19
- Updated: 2026-07-20
- Decision makers: Protocol lead (implementation proposal)
- Required reviewers: runtime/security lead (not yet recorded)
- Requirement IDs: X424-REQ-003, X424-REQ-009..012, X424-REPLAY-002

## Context

PROTOCOL.md defines JSON body digests via canonical JSON. Real HTTP mutations
use empty bodies, multipart, binary, and streams. Arbitrary object inference
produced colliding digests for distinct Blobs.

## Alternatives

1. Support JSON only; reject all other bodies at challenge time.
2. Infer object types automatically.
3. **Selected:** Explicit `RequestBodyDigestInput` kinds only.

## Decision

`requestDigest = sha256(canonical-json({ method, uri, bodyDigest }))` unchanged.

| Kind           | bodyDigest                                            |
| -------------- | ----------------------------------------------------- |
| absent / empty | `null`                                                |
| json           | plain JSON object/array only via `canonicalJson`      |
| opaque         | SHA-256 of exact bytes                                |
| precomputed    | validated `sha256:` + canonical base64url of 32 bytes |
| stream         | fail closed without precomputed                       |

Never infer Date, Blob, FormData, class instances, or other objects as JSON.
Reusable middleware MUST derive digest input from each incoming request; a
static configured digest is allowed only as an explicit per-invocation Fetch
input, never as shared middleware configuration.
Mutations SHOULD send `Idempotency-Key`. x424 guarantees dependency/result
single-use only.

## Security impact

Prevents digest bypass via type confusion. Does not weaken binding.

## Negative vectors / tests

- `digest-empty-body-null`
- `digest-opaque-bytes-distinct`
- `digest-stream-without-precompute-fails`
- `digest-precomputed-not-a-digest-rejected`
- `digest-non-json-object-rejected`

## Unresolved risks

Independent review of Content-Digest (RFC 9530) header verification remains
open; untrusted Content-Digest headers are not copied into requestDigest.
