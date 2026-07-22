# Program control artifacts

These files are the repository-controlled evidence for the public release gates
in [ROADMAP.md](../ROADMAP.md). They do not replace normative protocol
authority. Authority remains PROTOCOL.md, schemas, vectors, GOVERNANCE.md,
SECURITY.md, ADOPTER_CONTRACT.md, then ROADMAP.md.

| Artifact                                           | Deliverable | Purpose                                          |
| -------------------------------------------------- | ----------- | ------------------------------------------------ |
| [BASELINE_EVIDENCE.md](BASELINE_EVIDENCE.md)       | P0-02       | Truthful current-state and maturity evidence     |
| [SEVERITY_POLICY.md](SEVERITY_POLICY.md)           | P0-03       | Finding severity and exception policy            |
| [DEPLOYMENT_PROFILES.md](DEPLOYMENT_PROFILES.md)   | P0-03       | Numeric SLO/capacity/RTO/RPO profiles            |
| [CONFLICT_GOVERNANCE.md](CONFLICT_GOVERNANCE.md)   | P0-04       | Recusal, two-party approval, appeal              |
| [EXTERNAL_ENGAGEMENTS.md](EXTERNAL_ENGAGEMENTS.md) | P0-05       | Recruitment packages; not fabricated commitments |
| [THREAT_DATA_FLOW.md](THREAT_DATA_FLOW.md)         | P0-02       | Roles, trust boundaries, sensitive data flows    |
| [REQUIREMENT_IDS.md](REQUIREMENT_IDS.md)           | P0-03       | Stable MUST/SHOULD identifiers and vector map    |
| [DELIVERABLE_REGISTER.md](DELIVERABLE_REGISTER.md) | gates       | Status and evidence links by release gate        |
| [RELEASE_0.1.2.md](RELEASE_0.1.2.md)               | 0.1 package | Provenance-backed registry and image release     |

GitHub epics, issue labels, and named human owners require repository write
authorization and cannot be fabricated here. Until authorized, this register is
the in-repo tracking surface. Decision records live under
[docs/decisions/](../decisions/).

## Evidence rule

A deliverable is complete only when its acceptance evidence exists and is linked
from the register. Code alone is not a gate pass. External audits,
independently authored implementations, provider approval, unrelated production
adopters, and standards-venue acceptance remain externally blocked until real
evidence exists.
