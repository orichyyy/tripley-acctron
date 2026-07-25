# Target 64: Taiwan BSP Kiosk UI and Operator Diagnostics

## Status

Implemented.

## Purpose

Connect the command-driven kiosk customer journey to the canonical Taiwan BSP
withdrawal evidence produced by Targets 60 through 63, while preserving the
boundary between customer UI, Flow Engine, project orchestration, devices, and
host messages.

## Runtime boundary

- Customer components invoke commands and observe `OperationViewState`.
- React does not open XFS sessions, send BSP messages, or read sensitive
  operation material.
- `createTaiwanBspCustomerOperation` publishes each terminal orchestration
  result to a project-owned diagnostics port before translating failures into
  the outer customer-operation result.
- `ExampleApplicationRuntime` exposes only a read-only diagnostics source.
- Projects may inject another diagnostics port without changing framework
  core.

## Safe operator projection

`WithdrawalDiagnosticsStore` derives its data from the canonical
`WithdrawalInvestigationRecord`, then selects only:

- operation ID, terminal status, canonical and detailed reason
- host protocol and status
- card custody and authority-release facts
- cash dispense, present, taken, retract, and final custody facts
- before and after inventory snapshot IDs
- manual-reconciliation requirement

The projection deliberately ignores arbitrary `safeSummary` entries. It never
contains credential values, PAN, Track 2, PIN or PIN block, QR/reservation
payloads, raw device data, or host payloads.

## UI

The operator route now shows:

- current Flow Engine phase, operation reference, feedback reason, and media
  custody
- runtime readiness, entry method availability, hostd endpoint, logical
  services, and device health
- the latest canonical terminal withdrawal evidence
- explicit cash/card custody and reconciliation state

Diagnostic styling is isolated from the customer kiosk stylesheet so both
surfaces can evolve independently. The existing React Router usage remains in
the application UI boundary; framework core has no router dependency.

## Acceptance

- A `withdrawal.start` command journey publishes completed BSP evidence.
- Canonical cash-not-taken evidence shows present, taken, retract, custody, and
  inventory snapshot facts.
- The diagnostics screen renders current Flow and terminal evidence.
- Secret-like values placed in an upstream summary are not forwarded or
  rendered.
- The memory and hostd runtime modes share the same UI contract.
