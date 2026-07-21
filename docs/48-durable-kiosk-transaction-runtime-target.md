# Target 48: Durable kiosk transaction runtime

## Objective

Turn the withdrawal and deposit orchestrators into a production-composable runtime whose accounting,
audit, message, idempotency, outbox, migration, and finalization state survives process restart.

## Boundaries

- `storage-core` owns SQLite migration tracking, not business tables.
- `kiosk-base` owns transaction, message, audit/EJ, operation-ledger, and outbox persistence.
- `kiosk-runtime` owns startup ordering and readiness gating.
- `kiosk-transaction-runtime` composes withdrawal/deposit orchestrators without adding device or host
  protocol knowledge to core packages.
- Host Financial Completion remains optional. Local transaction, audit, and scoped-state finalizers
  remain mandatory.

## Startup order

1. Bootstrap the migration journal and run registered migrations.
2. Run the cash/card protection recovery barrier.
3. Enumerate and resume incomplete operation finalizations through the application recovery port.
4. Mark the transaction runtime ready and permit command execution.

Any intervention or failure before step 4 keeps transaction execution disabled.

## Deliverables

- `SqliteMigrationStore`.
- `SqliteTransactionRepository` and `SqliteTransactionMessageRepository`.
- `SqliteAuditJournalRepository`.
- `SqliteOperationLedger` and `SqliteOutbox`.
- Durable ledger schema migration for operation, entry method, phase, and media custody facts.
- `TransactionStartupCoordinator` with observable readiness and fail-fast execution guard.
- `createDurableKioskTransactionRuntime`, which constructs shared durable services and gated
  withdrawal/deposit orchestrators.

## Safety and data rules

- Message payloads are persisted only after application profile redaction/classification.
- EJ and transaction metadata contain safe facts, never PIN, PIN block, track data, or raw device
  responses.
- Message sequence allocation is serialized in a SQLite transaction.
- Idempotency-key creation returns the existing ledger record instead of starting duplicate work.
- A finalization record is never considered complete merely because Host Financial Completion is
  disabled or unavailable.

## Acceptance

- Recreating repositories over the same connection preserves transactions, messages, EJ, ledger,
  outbox, and incomplete finalization records.
- Concurrent message append uses unique increasing sequence numbers.
- Startup recovery runs in the documented order and operations fail fast before readiness.
- Both orchestrators can be composed with project-owned policies, host ports, device ports, and
  report projectors without modifying framework core.
- Full typecheck, build, and test suites pass.

