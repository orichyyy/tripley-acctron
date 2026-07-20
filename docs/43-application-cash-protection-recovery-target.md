# Application Cash Protection Recovery Target

## Status

Implemented.

## Goal

Connect phase-aware Tripley Native Host cash protection to the application Recovery Startup Barrier so safe host journal facts are durably and idempotently imported, projected, reconciled, and acknowledged before new customer operations are admitted.

## Boundary

- Hostd remains authoritative for Protection Phase, Cash Custody, deadlines, and protection actions.
- The application owns durable evidence import, project audit/EJ projections, application recovery-lease reconciliation, startup admission, and maintenance escalation.
- Protection recovery never resumes Flow, reconstructs authentication material, posts financial messages, or dispatches cash-affecting transaction commands.
- Resource groups are application configuration; the bridge does not infer or hard-code CDM/CIM logical service names.

## Import protocol

For every configured protection resource group:

1. Read the current host epoch and protection status.
2. Read safe journal records for the bound operation and reject mismatched group/operation records.
3. Atomically persist a host-epoch-bound recovery case and uniquely keyed imported records.
4. Run every registered projection with a stable idempotency key and persist each projection checkpoint.
5. Reconcile application recovery leases through the idempotent application port.
6. For a known terminal custody outcome, persist `ackPending`, acknowledge hostd, then persist `acknowledged`.
7. Return `ready` only when every configured resource group is idle or safely acknowledged.

Known terminal outcomes are `taken`, `retracted`, `committed`, `notMoved`, and `notAccepted`. `custodyUnknown`, unknown non-empty custody outcomes, a changed host epoch, missing journal evidence, or unexplained host idle state remain fail-closed in intervention. Non-terminal phases remain recovering.

## Crash consistency

- Imported records use a stable key derived from host epoch, resource group, operation, and host journal record ID.
- Projection adapters are open contributions and must durably deduplicate the supplied idempotency key.
- Completed projection checkpoints prevent unnecessary replay; a crash between projection and checkpoint may call the adapter again safely.
- Application lease reconciliation is idempotent by a stable case/classification/phase key.
- If host acknowledgement succeeds but its response is lost, `ackPending` plus idle status from the same host epoch closes the local case without issuing another acknowledgement.
- Idle status under a different host epoch does not prove acknowledgement and enters intervention.

## Persistence

Migration `xfs-device-service.002.protection-recovery` adds:

- one open recovery case per resource group;
- immutable safe imported journal payloads;
- per-record, per-projection completion checkpoints;
- acknowledgement intent/completion and intervention state.

The SQLite store and in-memory test store implement the same public port.

## Public extension ports

- `ProtectionRecoveryHostPort` isolates the host client boundary.
- `ProtectionRecoveryProjectionPort` supports project transaction evidence, audit/EJ, diagnostics, and management-report projections without core changes.
- `ProtectionRecoveryApplicationPort` reconciles project/application recovery leases without moving policy into hostd.
- `ProtectionRecoveryStorePort` allows alternative durable stores while preserving import semantics.

`XfsProtectionRecoveryHostAdapter` registers the built-in `@tripley-kit/xfs-client` boundary as an adapter rather than exposing raw xRPC behavior to recovery orchestration.

## Tests

- Terminal evidence is projected to operation evidence and audit/EJ before acknowledgement.
- A projection failure keeps the barrier recovering and does not repeat completed projections.
- Lost acknowledgement response is reconciled from same-epoch idle status without duplicate acknowledgement.
- Non-terminal protection remains recovering.
- Custody unknown remains intervention and is not acknowledged.
- A journal response containing another operation or resource group remains intervention and is not acknowledged.
- Host epoch change remains fail-closed.
- The migration contains durable case, import, and projection checkpoint tables.
- Barrier summaries expose counts only and omit operation identifiers and safe journal detail.

## Done when

- `ProtectionRecoveryStartupBarrier` structurally satisfies the Kiosk Runtime recovery startup port.
- New operations remain blocked until all configured resource groups are ready.
- No terminal host protection can be acknowledged before durable import, all configured projections, and application reconciliation complete.
- Restart and response-loss paths are idempotent and do not duplicate host acknowledgement.
- Unknown custody and host epoch changes cannot silently restore service.
- Project-specific evidence and EJ behavior can be added without modifying recovery core.
