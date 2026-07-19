---
status: superseded by ADR-0054
---

# CIM has distinct deposit custody outcomes

CIM acceptance does not reuse CDM delivery outcomes: a deposit ends physically only as `noMediaAccepted`, `committedToInventory`, `returnedAndTaken`, `retainedByDevice`, or `custodyUnknown`. A successful return or rollback that leaves media at the customer entry remains non-terminal until take or known device retention is observed, preserving recovery ownership and preventing command success from being mistaken for resolved customer custody.
