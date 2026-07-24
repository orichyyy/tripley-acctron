# Target 59: Taiwan BSP Withdrawal Application Vertical Slice

## Objective

Compose the existing BSP host runtime, withdrawal orchestration, XFS transaction
ports, durable SQLite runtime, audit/EJ boundary, and scoped state into a
project-owned withdrawal application boundary.

## Architecture

- Core orchestration remains unchanged.
- The project owns card ordering, optional Host Financial Completion, and
  pre-present gates.
- Card, PIN block, Track, and MAC values live only in an operation-scoped
  in-memory BSP context vault.
- Host authorization and completion resolve context by `operationId`.
- IWF context replaces PIN block, Track, MAC, and chip TAC with protocol-safe
  non-secret values.
- Durable transaction records, audit records, finalization context, and scoped
  state contain safe summaries only.
- XFS simulator mutation remains in `xfs-test-harness`; application code
  depends only on transaction ports.

## Transaction Order

1. Bind the sensitive BSP context to the operation.
2. Start the durable transaction.
3. Execute IWD authorization.
4. Start CDM cash delivery only after approval.
5. Dispense and evaluate project pre-present gates.
6. Resolve card custody according to project policy.
7. Present cash and resolve take or retract evidence.
8. Finalize transaction, audit, scoped state, and optional IWF.
9. Clear the sensitive BSP context on every exit.

## Safety

- Raw card, PIN block, Track, TAC, and MAC values are never copied into
  `safeMetadata`, transaction records, audit records, outcome summaries, or
  logs.
- Declined authorization cannot start CDM.
- Cancelled pre-present verification retracts staged cash and reports the
  resulting custody state to IWF.
- Cash take is confirmed only by a matching CDM `itemsTaken` event or an empty
  matching output position. `WFS_CDM_NOTPRESENTED` is not customer-take
  evidence.
- Missing Host Financial Completion capability fails during composition when
  the project enables completion.

## Acceptance

- Approved IWD drives dispense, card resolution, present, and cash take.
- Declined IWD performs no cash command.
- Pre-present cancellation performs no present and records retraction.
- Optional IWF receives the actual terminal cash outcome.
- Transaction, audit, finalization, and scoped-state reset complete durably.
- Sensitive BSP context is cleared on success, decline, cancellation, and
  failure.
- Project extensions require no core package changes.

## Combined Simulator Smoke

Start hostd with `runtime,tcp,xfs,xfs-control`, command leasing, and the XFS
simulator bridge. Start the BSP listener on `127.0.0.1:12008`, then run:

```powershell
pnpm test:target59-simulators
```

The opt-in smoke prepares the CDM through `xfs-test-harness`, but performs cash
delivery through the production XFS device-service port. The script builds the
device-service package before execution so the workspace smoke cannot consume
stale `dist` output. It proves:

`OEX -> IWD -> CDM dispense -> CDM present/take -> IWF`.
