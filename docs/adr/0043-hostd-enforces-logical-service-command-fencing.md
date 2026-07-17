# ADR 0043: Hostd enforces logical-service command fencing

Application-side recovery leases are necessary for durable ownership but cannot atomically guard the later native dispatch. Hostd therefore enforces a command lease per logical service. Side-effecting XFS commands carry operation identity, host epoch, and fencing token, and hostd rejects a stale or mismatched owner immediately before invoking the XFS manager.

The database `CashRecoveryLease` remains the authority for durable recovery decisions. Takeover advances its fencing token and binds the new owner at hostd before recovery commands are issued. Hostd restart creates a new host epoch, invalidates old connections and bindings, and requires unresolved recovery ownership to be rebound before the service can accept a new transaction.

Host fencing prevents stale execution but does not determine business outcome or cash custody. Read-only recovery observations may use a separately authorized path. If the current XRPC metadata and generated clients cannot carry and enforce command ownership, the native host, native client boundary, or XRPC runtime must be extended before CDM side-effecting commands are considered production-safe.
