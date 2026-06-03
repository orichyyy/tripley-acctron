# @tripley-acctron/contracts

Shared public contracts for the Tripley Acctron kiosk framework.

Update this document when public interfaces, flow schema, UI contracts, or native/device ports change.

## Interaction Contracts

The interaction layer defines `InteractionIntent`, `InputSource`, `InputSourceSession`,
`InputSourceContext`, reducer result types, and audit hooks.

Input sources normalize UI, pinpad, and barcode events into intents so Step Kit code can handle
business state transitions without directly managing device wait loops.

Standard intents now include text entry, selection, confirmation, cancellation, and barcode scan
parse results.

## Device Contracts

`DeviceManager` exposes optional ports for pinpad, barcode reader, card reader, cash dispenser, and
printer. Device contracts include operation cancellation and optional status checks.

`DeviceLease<TDevice>` and `ClaimableDevice<TDevice>` define the future exclusive-access shape for
hardware sessions.

Real native support still depends on the generated `@tripley-kit/native` client and is tracked in
`docs/native-required-capabilities.md`.

## Recovery Contracts

`TransactionResourceRegistry` lets steps register resources that need cleanup on normal end, cancel,
timeout, unhandled errors, or device failure.

`RecoveryManager` coordinates transaction recovery and is exposed on `StepContext` alongside the
resource registry.
