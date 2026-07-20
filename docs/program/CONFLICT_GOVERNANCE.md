# Conflict and decision governance

Version: `conflict-governance-0.2`
Status: program baseline

## Purpose

Prevent adopter, provider, verifier, or operator urgency from bypassing
protocol neutrality, exact-method acceptance, privacy boundaries, or
conformance discipline.

## Classification before code

Every requested capability is classified before implementation:

| Capability                                                    | Home             |
| ------------------------------------------------------------- | ---------------- |
| Portable dependency or security behavior                      | x424 core        |
| Provider-native ceremony or verification                      | provider profile |
| Storage, key custody, or deployment integration               | runtime package  |
| Product permission, identity state, payment, or business rule | adopter          |

Portable changes require a public decision record under `docs/decisions/`.
Application-specific concepts, fields, branches, or compatibility behavior are
rejected from protocol surfaces.

## Recusal and approval

A contributor representing an interested adopter, provider, verifier, or
commercial operator may propose requirements and provide evidence, but must
recuse from independently approving:

- the layer classification of its own request;
- the release gate that first ships that portable behavior; and
- any claim that the behavior proves interoperability or neutrality.

Portable protocol changes require approval from a protocol reviewer and an
independent security or interoperability reviewer who did not author the
change. Reference-only changes still require vector-preservation tests.

## Public decision records

Every portable decision records motivation, alternatives, security/privacy
impact, compatibility/migration impact, stable requirement identifiers,
positive/negative vectors, selected behavior, and unresolved risks.

## Appeal path

Disputed classification or conformance interpretation is appealed through a
public issue. Shipping the disputed interpretation freezes until the release
authority and a previously uninvolved reviewer resolve it in a superseding or
confirming decision record. Ambiguity always fails closed.

## Release authority

| Release | Minimum independent evidence                                                |
| ------- | --------------------------------------------------------------------------- |
| 0.1     | design review, vectors, reproducible package, zero Critical                 |
| 0.2     | deployment assessment, operational drills, zero Critical or unaccepted High |
| 0.3     | compatibility matrix, independent implementation/provider/verifier/adopters |
| 1.0     | all stable gates plus independent stakeholder representation                |

Emergency fixes follow the private disclosure process, never weaken
fail-closed behavior, add regression vectors, and bump protocol versions when
wire or acceptance semantics change.
