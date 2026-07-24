# Target 56: Taiwan BSP v2.43 Withdrawal Host Vertical Slice

## Objective

Implement the application-owned Taiwan BSP v2.43 host integration for chip-card
TWD withdrawal authorization and optional Host Financial Completion.

## Scope

- Define fixed-field `IWD` request/reply and `IWF` Confirm request/reply profiles.
- Keep the profile compiled into the kiosk application.
- Resolve sensitive financial context by operation ID only when a message is packed.
- Bind authorization and optional completion to durable host delivery.
- Map host reject codes through project configuration.
- Map terminal withdrawal outcomes to the BSP exception kind/number through a
  project policy.
- Reference the original IWD center sequence, ATM system date, and ATM sequence
  from IWF.
- Emit safe summaries that never include account, PIN block, track data, TAC, or
  MAC values.

## Protocol Decisions

- `IWD` is the withdrawal authorization transaction.
- `IWF` is the withdrawal Confirm transaction used by withdrawal machines.
- BSP v2.43 does not define an independent `IWR` reversal transaction. Failure,
  interruption, and uncertain cash-custody evidence is carried by the project
  mapping of the IWF exception fields.
- The host completion message is enabled only for projects whose withdrawal
  protocol mode is `authorization-then-completion`.
- Local transaction, audit, and scoped-state finalizers remain mandatory and run
  before optional Host Financial Completion.
- BSP exception values are not invented by the framework. Each bank project must
  provide its own completion reason policy.

## Extension Boundary

The context provider owns bank-specific account, PIN, chip, MAC, currency, and
terminal field projection. The completion reason policy owns bank-specific
exception codes. Neither requires changes to framework packages.

## Acceptance

- IWD and IWF requests pack to 720 bytes.
- IWD replies unpack from 373-byte payloads carried in 385-byte wire frames.
- IWF replies unpack from 656-byte FISC-II payloads carried in 668-byte wire frames.
- Host approval and decline replies map to the withdrawal orchestration contract.
- Authorization-only projects expose no completion operation.
- Completion-enabled projects send IWF with original request references and
  project-mapped terminal evidence.
- Safe summaries contain no secure financial values.
