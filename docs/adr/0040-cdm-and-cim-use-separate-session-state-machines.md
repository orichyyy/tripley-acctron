# ADR 0040: CDM and CIM use separate session state machines

CDM cash delivery and CIM cash acceptance are separate deep modules with distinct session state machines. A delivery session owns denomination, dispense, staging, authorized presentation, take, retract, and delivery custody. An acceptance session owns acceptance, escrow, counting, commit, return, retract, and deposit custody. Staged cash is not customer-delivered, and escrowed media is not committed inventory.

The sessions share cash inventory snapshots, operation evidence recording, cash-unit identity and revision rules, device locking, recovery supervision, reconciliation contracts, and investigation projection registries. They do not share a broad state enum or generic cancellation behavior that would erase their different physical semantics.

Implementation proceeds with the XFS module-adapter refactor and a CDM delivery vertical slice first, followed by CIM acceptance on the proven shared infrastructure. CIM-specific behavior is not simulated through CDM abstractions merely to complete the first slice.
