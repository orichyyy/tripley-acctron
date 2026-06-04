# @tripley-acctron/flow-engine

Flow compiler, engine, step registry, raw steps, timeout service, interaction runtime, and step
lifecycle scope.

Update this document when flow graph schema, step results, or scope behavior changes.

## Timeout

`DefaultTimeoutService` supports expiring timeouts, reset, cancel, abort-signal cancellation, and
More Time dialogs through `UiPort`.

## Interaction

`InputSources` provides source factories for UI actions, UI choices, UI confirm/cancel, numeric
pinpad input, pinpad function keys, pinpad confirm/cancel, barcode QR scans, and empty sources.

`InteractionRuntime` starts all sources for a screen, waits for the first intent, audits it, resets
timeout, runs the reducer, patches UI state, and stops all sources when the interaction ends.

## Standard Step Kit

`defineTextInputStep`, `defineChoiceStep`, and `defineConfirmStep` wrap common kiosk interactions
around `InteractionRuntime`.

`defineHostRequestStep` supports callback-based host logic and direct `ctx.host.request()` calls
through `messageType`/`body` definitions.

`defineWaitDeviceStep` remains a callback-based skeleton for expanded device workflows.

## Recovery

`InMemoryTransactionResourceRegistry` stores transaction resources and recovers active resources in
reverse registration order.

`DefaultRecoveryManager` shows a recovering screen, cancels pending device operations, runs resource
recovery, and clears transaction resources. `FlowEngine` invokes recovery for unhandled step errors
and normal flow completion.
