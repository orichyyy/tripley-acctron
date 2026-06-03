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

`PinpadDevice` now exposes `waitKey()` plus `cancel()`.
`BarcodeReaderDevice` now exposes `read()` plus `cancel()`.

Real native support still depends on the generated `@tripley-kit/native` client and is tracked in
`docs/native-required-capabilities.md`.
