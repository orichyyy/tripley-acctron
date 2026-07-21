# Target 47: Hostd-backed transaction vertical slice

## Objective

Prove that application transaction orchestration can cross the production XFS boundary without
depending on simulator APIs, while retaining enough durable state to resume finalization after a
process restart.

## Boundaries

- Production code uses `@tripley-kit/xfs-client` only through `xfs-device-service` ports.
- `@tripley-kit/xfs-control-client` remains a test-harness dependency and may only prepare or act on
  simulator media.
- Logical service names, protection resource groups, and policy profile identifiers are
  configuration. No application flow assumes `CIM`, `CDM`, or `IDC` as a fixed name.
- Host command leases are mandatory for cash movement. The host epoch and fencing token remain
  owned by the device-service lease adapters.
- Inventory snapshots contain cash-unit counters and a content revision only. Raw XFS payloads,
  serial numbers, and customer data are not audit metadata.

## Deliverables

1. `SqliteOperationFinalizationStore` and a framework migration for restart-safe finalization.
2. A CIM device port that creates cash-acceptance services, captures safe inventory summaries, and
   resolves refused media with cancellation-aware take/retract behavior.
3. Deposit orchestration adapters for CIM inventory and refused-media ports.
4. A test-only CIM simulator harness and an opt-in hostd contract that proves required modules,
   command leasing, inventory capture, cash-in, commit, and simulator media removal.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `TRIPLEY_NATIVE_HOSTD_URL` | `ws://127.0.0.1:39010` | Host websocket endpoint |
| `TRIPLEY_XFS_CIM_LOGICAL_NAME` | discovered | CIM logical service override |
| `TRIPLEY_XFS_CIM_INPUT_POSITION` | `4` | Simulator cash-in input position |
| `TRIPLEY_XFS_CIM_OUTPUT_POSITION` | `512` | Simulator rollback output position |
| `TRIPLEY_XFS_CIM_RESOURCE_GROUP` | `cash-transport-1` | Lease/protection resource group |
| `TRIPLEY_XFS_PROTECTION_PROFILE` | `real-smoke` | Host protection profile |
| `XFS_REAL_CIM_TRANSACTION_SMOKE` | unset | Must equal `I_UNDERSTAND_SIMULATOR_ONLY` to mutate simulator state |

## Recovery invariants

- An operation is incomplete until every required local finalizer succeeds.
- Optional Host Financial Completion never suppresses local cleanup.
- A malformed durable finalization record fails closed rather than being silently ignored.
- An aborted refused-media wait does not issue a new retract command under the cancelled signal.
- A timed-out refused-media wait follows the configured retract policy and returns a safe terminal
  classification.

## Acceptance

- SQLite finalization records survive store recreation and incomplete records can be enumerated.
- CIM inventory adapters produce deterministic, safe revisions and preserve transaction boundary
  metadata.
- Refused-media adapters distinguish taken, retracted, cancelled, and unresolved outcomes.
- The opt-in hostd contract uses `requiredModules: ["manager", "cim"]`, acquires a fenced command
  lease, mutates media only through `xfs-control-client`, and commits a real simulator cash-in.
