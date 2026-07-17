# ADR 0041: Non-terminal cash operations use persistent fenced recovery leases

Before the first physical cash movement, a CDM or CIM session durably creates a `CashRecoveryLease`. The lease identifies the operation, session, module, logical service, last known physical phase, evidence sequence, owner instance, recovery deadline, and a monotonically increasing fencing token. Phase changes update the durable lease, and a confirmed custody terminal outcome closes it.

Application startup and hostd reconnection scan unresolved leases before enabling new cash transactions. A recovery supervisor acquires ownership with a compare-and-swap operation that advances the fencing token. Commands from stale browser tabs, WebSockets, runtime instances, or expired owners are rejected. An unresolved lease for a logical service prevents a new cash-changing operation on that service.

Recovery does not depend on an in-memory session or native command handle. It reconnects to the logical service and uses device status, present status, events, compatible inventory observations, and prior evidence to retract or reconcile. If custody remains unknown, the device stays unavailable until an authorized administrator records reconciliation evidence. Restarting hostd does not clear the lease or manufacture a terminal outcome.
