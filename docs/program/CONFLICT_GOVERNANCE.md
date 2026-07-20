# Conflict and decision governance

Version: `conflict-governance-0.1`  
Status: program baseline  
Related: [GOVERNANCE.md](../GOVERNANCE.md), [EXECUTION_PLAN.md](../EXECUTION_PLAN.md) §12

## Purpose

Prevent adopter urgency, especially from Problee as adopter zero, from bypassing
protocol neutrality, exact-method acceptance, privacy boundaries, or
conformance discipline.

## Classification before code

Every gap discovered through an adopter must pass the classification test in
EXECUTION_PLAN.md §12 before x424 code is written. Portable changes require a
public decision record under `docs/decisions/`.

## Recusal

The Problee adoption lead **recuses** from:

- approving layer classification of changes requested by Problee;
- approving the release gate that first ships those portable changes; and
- acting as the sole “independent” reviewer for Problee-driven protocol work.

The adoption lead may propose requirements and supply public-surface evidence.
They may not self-approve that a Problee need is core protocol.

## Two-party approval for portable changes

Portable protocol changes (wire, signature, canonicalization, binding, replay,
privacy, metadata, versioning, acceptance) require approval from:

1. a protocol reviewer; and
2. an independent security or interoperability reviewer who did not author the
   change and does not report to the change owner for the engagement.

Reference-implementation-only changes that preserve published vectors still
need tests proving vector preservation but do not need the full two-party
portable-change process unless they alter public behavior.

## Public decision records

Each portable decision must record:

- motivation and alternatives;
- security and privacy analysis;
- compatibility and migration analysis;
- stable requirement identifiers;
- positive and negative vectors;
- selected behavior and unresolved risks.

Template: [docs/decisions/0000-template.md](../decisions/0000-template.md).

## Appeal path

Disputed layer classification or conformance interpretation is appealed by:

1. filing a public issue referencing the decision ID and conflicting artifacts;
2. freeze on shipping the disputed interpretation while appeal is open;
3. review by release authority plus one reviewer who has not previously
   approved the disputed decision;
4. resolution recorded as a superseding decision or confirmation.

Ambiguity fails closed: implementations must not choose the interpretation that
accepts more proofs.

## Release authority

| Release | Authority                                                    | Minimum evidence                              |
| ------- | ------------------------------------------------------------ | --------------------------------------------- |
| 0.1     | Release authority + Phase 1 design review disposition        | vectors, pack smoke, zero Critical            |
| 0.2     | Release authority + independent gate panel for named profile | auth, durable state, ops, assessment          |
| 0.3     | Release authority + independent gate panel                   | interop matrix, second impl/provider evidence |
| 1.0     | Release authority + independent stakeholder panel            | all stable gates in GOVERNANCE.md             |

## Emergency security fixes

Security fixes may ship under an accelerated process when:

- disclosure follows SECURITY.md / repository security policy;
- the fix does **not** weaken versioning, privacy, exact-method acceptance, or
  fail-closed defaults;
- a decision record is published as soon as safe;
- negative vectors covering the defect are added before or with the fix;
- a protocol version bump is used if wire or acceptance semantics change.

Emergency fixes must not silently reinterpret an existing protocol or
descriptor version.
