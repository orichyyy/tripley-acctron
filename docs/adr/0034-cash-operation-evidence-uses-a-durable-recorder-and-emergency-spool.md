# ADR 0034: Cash operation evidence uses a durable recorder and emergency spool

Safety-critical device sessions depend on an `OperationEvidenceRecorderPort`, not on SQLite, an EJ file, or a bank reporting protocol. A successful append returns a durable receipt only after canonical evidence and its EJ projection outbox entry have been stored atomically. Project adapters render the outbox into bank-specific EJ output and management-system reports without modifying the canonical evidence.

Before physical cash movement, evidence persistence is fail-closed. The runtime must durably record the complete `before` inventory snapshot and command intent before invoking the first cash-affecting XFS command.

After cash movement may have started, custody safety takes precedence over evidence-store availability. A recorder failure must not prevent present-status checks, retract, deposit rollback, recovery, or operator escalation. Subsequent safely redacted evidence is appended to a local emergency spool, the operation is marked `reconciliationRequired`, and recovery replays records in their original operation and sequence order. The spool is not a second source of business truth and cannot be used to report a more certain physical outcome than the captured evidence supports.
