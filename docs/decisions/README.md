# Decision records

Portable protocol, transport, canonicalization, binding, replay, privacy,
metadata, versioning, and acceptance decisions use the template in
[0000-template.md](0000-template.md).

Rules:

- Ambiguity fails closed; never resolve by accepting more proofs.
- Do not silently reinterpret an existing protocol or descriptor version.
- Link stable requirement IDs from [REQUIREMENT_IDS.md](../program/REQUIREMENT_IDS.md).
- Update schemas, OpenAPI, vectors, types, examples, and normative text together.
- Adopter-, provider-, or operator-driven portable changes follow
  [CONFLICT_GOVERNANCE.md](../program/CONFLICT_GOVERNANCE.md).
