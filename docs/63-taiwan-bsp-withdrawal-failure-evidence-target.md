# Target 63: Taiwan BSP Withdrawal Failure Evidence

## Status

Implemented.

## Purpose

Prove that withdrawal failures remain fail-closed and produce one canonical,
safe investigation record across flow, host, card, cash, transaction database,
EJ, and project-specific reporting.

## Canonical failure reasons

`createWithdrawalInvestigationRecord` maps framework outcomes to:

- `cancelled`
- `timeout`
- `hostDeclined`
- `hostUnavailable`
- `dispenseFailed`
- `cashPresentationFailed`
- `cardNotTaken`
- `cashNotTaken`
- `custodyUnknown`
- `recoveryBlocked`
- `failed`

The record keeps `outcomeReason` as the detailed framework reason. The
canonical reason is intended for operations dashboards and bank reports.

## Custody and inventory evidence

The record preserves:

- card status, reason, media state, and authority release
- dispense, present, taken, retract, and final cash custody facts
- before/after snapshot IDs stored in transaction metadata
- verified cassette observations when the project joins snapshots by ID
- whether manual reconciliation is required

Snapshot IDs must match the terminal outcome. A mismatched snapshot fails
closed instead of producing a misleading report.

Projects implement `WithdrawalInvestigationRenderer<T>` to generate their own
EJ or management-system format. Renderers cannot change the canonical record.

## Persistence

The standard withdrawal transaction adapter stores
`withdrawalFailureReason`, custody facts, and before/after snapshot IDs. The
standard terminal audit event stores the same canonical failure reason and
safe summary. Full cassette counts remain in the cash evidence store and are
joined through the verified snapshot IDs.

## Simulator fault automation

`withHostdXfsCommandFailure` is a test-harness-only adapter over
`xfs-control-client`. It saves the current SP execute return policy, installs a
volatile command error, executes one scenario, and restores or clears the
policy in `finally`.

The Target 63 real smoke proves:

1. cash is presented but not taken
2. take timeout dispatches retract
3. final custody is `retracted`
4. before and after snapshots are captured
5. CDM dispense failure can be injected without modifying core
6. the command policy and XFS sessions are cleaned up

## Safety

The smoke runs only when both values are set:

```powershell
$env:TARGET63_SIMULATOR_SMOKE = "1"
$env:TARGET63_SIMULATOR_CONFIRM = "I_UNDERSTAND_SIMULATOR_ONLY"
```

Its output contains only logical service, failure classification, custody, and
snapshot boundaries. It never prints PIN, PIN block, PAN, Track 2, host
payload, or customer data.

## Command

```powershell
$env:TARGET63_SIMULATOR_SMOKE = "1"
$env:TARGET63_SIMULATOR_CONFIRM = "I_UNDERSTAND_SIMULATOR_ONLY"
$env:TRIPLEY_NATIVE_HOSTD_URL = "ws://127.0.0.1:39010"
pnpm exec vitest run apps/kiosk-example/script/bsp-v243/target63-cdm-failure-simulator.smoke.test.ts
```

The BSP host simulator is not required for this CDM fault smoke. Target 62
continues to prove the real OEX/IWD/IWF host path. Fast vertical tests cover
host decline, customer cancel, card-not-taken, cash-not-taken, and dispense
failure without consuming physical simulator sessions.
