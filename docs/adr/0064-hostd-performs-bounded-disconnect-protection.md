# Hostd performs bounded disconnect protection

Hostd atomically enters internal Protection Authority when an application command owner is lost and executes only deployment-frozen, host-validated media-safeguarding actions such as observation, rollback, eject, retain, or retract. This refines but does not transfer ADR-0045's bank recovery ownership: hostd persists a Protection Journal and never resumes Flow, posts financial messages, dispenses, presents cash, or initiates CIM Physical Commit; application recovery later imports those physical facts and completes transaction reconciliation.

The initial implementation uses declarative startup configuration and a closed action vocabulary. A startup-loaded plugin contract is reserved for policies configuration cannot express, but plugins cannot dispatch XFS directly; a future sandboxed implementation requires a concrete project need, while plugin failure or illegal output holds fencing and enters intervention.
