# ADR 0044: Logical-service leases enforce command authority modes

Host-backed logical-service leases carry an explicit command authority mode rather than acting as an untyped lock. Transaction authority permits the configured transaction lifecycle; recovery authority permits investigation and custody-safety operations but does not initiate a new dispense; maintenance authority permits configuration, replenishment, counting, reset, and approved test operations; observation authority is restricted to a read-only whitelist. Simulator-control authority exists only in test environments.

Only one side-effecting authority may own a logical service. Maintenance cannot coexist with an active transaction or unresolved recovery. Recovery may take over an expired transaction through durable compare-and-swap ownership and a new fencing token, while a new transaction cannot preempt recovery. Completing maintenance creates a new cash-unit revision and invalidates plans bound to the previous revision.

`@tripley-kit/xfs-control-client` is confined to simulator tooling and automated tests and must not enter the production kiosk dependency graph. Production does not expose an unfenced management path. Hostd validates both token freshness and the authority command whitelist immediately before native dispatch.
