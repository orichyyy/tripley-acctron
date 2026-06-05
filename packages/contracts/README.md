# @tripley-acctron/contracts

Shared public contracts for the Tripley Acctron kiosk framework.

Update this document when public interfaces, flow schema, UI contracts, or native/device ports change.

## Observability Contracts

`ElectronicJournal` writes structured `JournalEntry` records.

`RedactionService` is the required boundary for masking PIN, password, account, card, ID, barcode,
and customer input values before they are written to log or EJ sinks.

`InteractionAuditService` records prompt begin/end, customer choices, and customer input. It is
available on `StepContext` for standard steps and custom steps.

## Interaction Contracts

The interaction layer defines `InteractionIntent`, `InputSource`, `InputSourceSession`,
`InputSourceContext`, reducer result types, and audit hooks.

Input sources normalize UI, pinpad, and barcode events into intents so Step Kit code can handle
business state transitions without directly managing device wait loops.

Standard intents now include text entry, selection, confirmation, cancellation, and barcode scan
parse results.

## Host Contracts

`HostGateway` provides the canonical business API for host request/response calls.

`HostTransport`, `HostCodec`, and `HostMessageMapper` keep transport, wire encoding, and customer
message mapping replaceable by plugins.

`HostCommand` defines canonical suspend, resume, and maintenance commands that host plugins can
dispatch to application state later.

## Operational Control Contracts

`ServiceOperationalStatus` reports online, suspending, suspended, and maintenance states.

`service.applyHostCommand`, `service.resume`, `service.enterMaintenance`, and
`service.exitMaintenance` are typed command bus commands. `service.status` is the typed query for
runtime service state.

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

## Transaction Lifecycle Contracts

`FlowRunner` defines the cancellable flow execution shape used by runtime orchestration.

`transaction.start`, `transaction.cancel`, and `transaction.reset` are typed `CommandBus` commands.
`transaction.status` is the typed `QueryBus` query for idle, running, completed, cancelled, and
failed lifecycle state.

## Milestone 10 Contracts

`TransactionDataStore` is exposed as `StepContext.transaction` for recipe and business data.

`TtsService`, `VoiceGuideService`, `AudioAssetResolver`, and `AudioPlayer` are exposed through
accessibility contracts so steps can request speech or prerecorded audio without depending on a
browser or native implementation.

`WindowManagerPort` is exposed as `StepContext.windows` for supervisor/operator/diagnostic window
coordination.
