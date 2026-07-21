# Target 49: Kiosk durable integration and recovery smoke

## Objective

Prove that a kiosk project can compose the durable transaction runtime with project-owned policies,
native SQLite, XFS hostd devices, and restart recovery without modifying framework core.

## Boundaries

- `kiosk-runtime` owns durable finalization recovery contracts and plan routing.
- `kiosk-transaction-runtime` owns the standard withdrawal/deposit recovery composition.
- `storage-sqlite/node` is the Node and automation SQLite boundary. Browser applications continue to
  use `NativePortSqliteConnection` and never import Node APIs.
- `kiosk-example` owns bank policy choices, logical service names, review gates, and Host Financial
  Completion enablement.
- Simulator mutation remains isolated in `xfs-test-harness`.

## Startup and recovery order

1. Open the project SQLite connection.
2. Apply framework and project migrations.
3. Complete the host protection recovery barrier.
4. Route every incomplete finalization record to the runner matching its frozen plan version.
5. Enable transaction execution only after all records resume successfully.

Unknown plans, missing recovery contexts, incompatible versions, and failed finalizers require
operator intervention and keep transaction commands disabled.

## Durable finalization context

- Persistence is opt-in through an explicit context projector.
- The default finalization runner does not persist arbitrary `result`, `error`, or metadata values.
- Standard withdrawal and deposit composition projects only their typed terminal outcomes and safe
  policy metadata.
- Raw PINs, PIN blocks, track data, credentials, and native device responses are never recovery
  context.

## Deliverables

- `OperationFinalizationRecoveryContext` and projector contract.
- Resumable `OperationFinalizationRunner` with frozen-plan compatibility checks.
- `OperationFinalizationRecoveryRegistry` keyed by plan version.
- Automatic withdrawal/deposit recovery runner registration in the durable transaction runtime.
- `NodeSqliteConnection` under the explicit `storage-sqlite/node` export.
- Example-owned withdrawal/deposit policy builders and durable application composition.
- Real SQLite file restart test covering transaction evidence and incomplete finalization recovery.
- Opt-in hostd CDM/CIM smoke that persists safe device summaries and verifies them after reopening the
  SQLite file.

## Acceptance

- A failed local finalizer resumes after a process restart without rerunning completed steps.
- Missing or incompatible recovery plans result in intervention, never ready state.
- Transaction, message, audit/EJ, and finalization evidence survive closing and reopening a real
  SQLite file.
- Host Financial Completion remains project-configurable and local finalizers remain mandatory.
- The hostd smoke proves CDM requiredModules/profile automation and a fenced CIM transaction before
  reopening durable evidence.
- Full typecheck, build, and test suites pass.
