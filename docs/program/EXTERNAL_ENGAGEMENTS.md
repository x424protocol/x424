# External engagement packages

Version: `external-engagements-0.1`  
Status: **recruitment package ready; not yet contracted**

This document defines scopes and acceptance criteria. It does **not** claim
funded partners, signed audits, independent implementations, provider approval,
or unrelated adopters. Those remain externally blocked until real evidence
exists.

## Shared rules

- Public artifacts and released packages only; no private guidance that becomes
  a hidden compatibility path.
- Synthetic/fake provider data for tests; no production credentials.
- Findings published with severity under `SEVERITY_POLICY.md`.
- Critical findings block the named gate; High findings follow exception policy.

---

## E1 — Phase 1 design / threat review

**Objective:** external review of 0.1 HTTP semantics, wire contract,
canonicalization candidate, cryptographic construction, and threat model.

**Scope deliverables from x424:** PROTOCOL.md, schemas, OpenAPI, vectors,
SECURITY.md, THREAT_DATA_FLOW.md, decision records for transport/digest/canon,
TypeScript reference for clarification only.

**Acceptance criteria:**

- written report with method, assets reviewed, findings, severity;
- zero Critical remaining before 0.1 tag;
- every High closed or time-bounded under severity policy;
- every corrected ambiguity converted into a conformance vector.

**Status:** package ready; engagement not contracted.  
**Lead-time risk:** 2–6 weeks after funding/scheduling.

---

## E2 — Phase 2 production / deployment assessment

**Objective:** independent assessment of a named deployment profile
(`eval-redis-0.2` or `prod-ha-0.2`).

**Scope:** authenticated issuance, metadata/key trust, Redis/PostgreSQL state,
container image, rate limits, abuse controls, privacy/DPIA operator roles,
failure injection, load against named targets.

**Acceptance criteria:**

- signed report against the named profile;
- zero Critical; no unaccepted High;
- RTO/RPO drill evidence reviewed;
- gate record suitable for 0.2 RC.

**Status:** package ready; engagement not contracted.  
**Lead-time risk:** 4–10 weeks; often critical path for Problee enforcement.

---

## E3 — Independent non-TypeScript implementation

**Objective:** independently authored implementation passes all normative
vectors and a mixed-stack interop flow.

**x424 supplies:** frozen interop-candidate canonicalization, vectors,
schemas, OpenAPI, black-box conformance CLI, public-only clarification log.

**Acceptance criteria:**

- different primary author/org from x424 maintainers;
- all normative vectors pass;
- bidirectional mixed-stack flow with reference verifier or resource server;
- clarification log contains no private privileged semantics.

**Status:** mobilization package ready; implementer not contracted.  
**Lead-time risk:** 8–16 weeks; start as soon as P1-03 freezes candidate bytes.

---

## E4 — Second provider profile

**Objective:** materially different trust model with complete fixtures.

**Acceptance criteria:**

- independent reviewer confirms different root of trust plus materially
  different proof/uniqueness/recovery/lifecycle model;
- exact descriptor, positive/negative native fixtures, privacy/lifecycle review;
- no wrapper around World ID counting as second provider.

**Status:** selection criteria ready; provider not selected/approved.  
**Lead-time risk:** provider legal/engineering review often dominates.

---

## E5 — Independent verifier / facilitator

**Objective:** independently operated verifier with authenticated metadata,
conformance, and operator-swap evidence.

**Acceptance criteria:**

- operator ≠ x424 maintainer deployment;
- metadata and key discovery work;
- resource server can swap operators without changing resource contract;
- black-box conformance suite passes.

**Status:** operator requirements ready; operator not engaged.  
**Lead-time risk:** 4–12 weeks after 0.2 RC artifacts exist.

---

## E6 — Unrelated production adopters

**Objective:** two production relying parties unrelated to x424 and Problee
maintainers, using public surfaces only.

**Acceptance criteria:**

- public-surface adoption reports;
- no private maintainer intervention required for interop;
- no Problee-specific or privileged protocol path.

**Status:** onboarding package ready; adopters not recruited.  
**Lead-time risk:** calendar-dominated; cannot be fabricated.

---

## Evidence checklist (per engagement)

- [ ] Named counterparty or funded recruitment owner (external)
- [ ] Signed scope / SOW or public call with acceptance criteria
- [ ] Artifact freeze ID (tag/commit) under review
- [ ] Report or interop evidence URL
- [ ] Finding disposition linked to severity policy
- [ ] Deliverable register updated (`externally_blocked` → evidence path)
