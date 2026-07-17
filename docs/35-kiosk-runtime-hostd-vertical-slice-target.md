# Kiosk Runtime and Hostd-backed Withdrawal Vertical Slice

## Objective

Turn the existing result-summary kiosk example into a production-shaped, interactive kiosk application that runs in explicitly selected memory or hostd mode. The slice must exercise framework-owned Command, Condition, Flow, UI, Device, InputSource, Audit, Logging, TTS, recorded-prompt, scoped-state, idempotency, recovery, and extension boundaries without exposing Tripley Kit clients to business or React code.

The first live device slice covers contact card, online PIN, and QR over the already-proven hostd/XFS integration. It also proves that a bank can add reservation withdrawal and a future NFC plugin without changing framework core.

## Required Architecture

### Kiosk runtime boundary

Add `packages/kiosk-runtime` as a deep module with a small composition facade. It owns:

- `EntryMethodRegistry`.
- `AuthenticationChallengeRegistry`.
- `AuthenticationPlanPolicy`.
- `CustomerOperationCoordinator`.
- The single active customer-operation lease.
- Runtime readiness and per-entry-method availability.
- Operation deadlines, interaction timeouts, and attempt budgets.
- Recovery and custody reconciliation.
- Safe `OperationViewState` projection.
- Composition of existing Flow, Command, Condition, Device, InputSource, Audit, Logging, and scoped-store contracts.

`kiosk-runtime` must not depend on React, React Router, Tripley XFS clients, hostd transport, or bank-specific entry IDs.

### Mandatory refactor first

Before adding behavior, split the existing oversized `kiosk-base` withdrawal example, services, and repositories modules into focused files. Preserve current public behavior and keep reusable bank-project services in `kiosk-base`. Do not append runtime orchestration to the existing large modules.

Keep the generic plugin system unaware of withdrawal, card, NFC, PIN, QR, reservation, or XFS concepts. If integration requires changing the oversized plugin manager, split it by responsibility before adding behavior.

### Explicit runtime modes

Support two startup-selected modes:

- `memory`: deterministic adapters for CI and simulator-free development.
- `hostd`: real hostd transport and `xfs-device-service` composition.

Mode selection occurs before runtime creation. Missing required hostd capability fails closed with visible diagnostics and never silently substitutes memory adapters. An operator may explicitly request a runtime reboot into another mode after the active operation and owned resources have been safely closed.

Hostd transport, `TripleyXfsClient`, and `XfsDeviceService` live for the entire kiosk runtime. They are not recreated per operation or route. Connection loss interrupts dependent work and requires an explicit runtime reboot before reconnecting.

### Open entry methods

Entry methods are project contributions, not a framework enum. A contribution provides a stable ID and version, availability condition, credential-acquisition subflow contract, capability dependencies, interrupt bindings, media-custody policy, and safe summary policy.

The example preset orders contact card before QR, but core assigns no special meaning to either ID. A selected operation freezes its contribution ID and version. Registry or configuration changes affect only later operations.

Implement these example contributions:

- Contact card backed by the XFS IDC port in hostd mode and a deterministic adapter in memory mode.
- QR backed by `barcodeReader.qr` in hostd mode and a deterministic adapter in memory mode.
- Bank-specific reservation withdrawal behind a feature flag, using standard UI input sources and no XFS dependency.

Add a fake NFC contract fixture proving that a custom device/input adapter and entry contribution work without modifying kiosk runtime, Flow Engine, or framework core. A real NFC hardware adapter is not part of this target.

### Credential and authentication safety

Raw card, QR, reservation password, and similar acquisition material may exist only during acquisition and immediate verification. They must not enter scoped state, operation ledger, audit, UI state, Flow trace, logs, or hook payloads.

Successful acquisition produces a safe `AccessCredential` and `CredentialAssessment`. The assessment contains declarative authentication requirements, not executable Flow definitions, device names, scripts, URLs, or arbitrary input profiles.

Local `AuthenticationPlanPolicy` must:

- Merge remote requirements with mandatory bank policy.
- Resolve only registered challenge contributions.
- Validate bounded parameters against the selected contribution schema.
- Reject unknown, unavailable, incompatible, or weaker plans.
- Freeze challenge IDs, versions, and order for the operation.

Implement online PIN as a registered challenge. The application never receives plaintext PIN; it handles only the device-produced PIN block or safe result. Reservation secret and fake NFC challenges prove that authentication is not hard-coded to PIN.

### Single customer operation

One kiosk runtime permits at most one active customer operation. Accepting `withdrawal.start` atomically acquires the operation lease before credential acquisition. Duplicate UI intents return the idempotent existing result; competing entry methods receive `operation.alreadyActive`.

Node-level device locks remain mandatory. The operation lease and device locks solve different ownership problems.

Release the operation lease only after input and prompt sessions are cancelled, device locks are released, scoped state is reset, audit is finalized, and physical-media custody is resolved or escalated to terminal intervention.

### Time and reentry policy

Each operation has an absolute operation deadline. Validation reentry cannot renew it. User-facing stages use named interaction timeouts that valid activity may renew only within the operation deadline.

Local validation failure remains on the same node and updates safe UI feedback. Business validation may reenter the input node but consumes a bounded attempt budget. Authentication attempt limits come from approved policy and cannot be widened by the application.

Accessibility may apply a bounded interaction-time multiplier but cannot change authentication attempts or the hard safety deadline. Technical hostd or business-service timeout is not reported as user inactivity.

Media-custody compensation may continue after the business deadline until custody is returned, retained, or classified unknown for intervention.

### Physical media custody

Extend the framework-owned XFS card-reader port with safe operations for:

- Current media status.
- Eject/present.
- Retain when supported and allowed by policy.
- Wait for media taken.
- Cancellation.
- Safe custody summaries.

Once a card enters the device, the contact-card contribution owns media custody. Normal completion, business rejection, timeout, and interruption all execute card-return compensation. After eject, the UI enters a take-card state and waits for media-taken.

If the card is not taken, retain it when supported and allowed. Otherwise enter terminal intervention and block new customer operations. Never reset IDC blindly while custody is unresolved.

Audit records only safe custody outcomes such as `returned`, `retained`, and `custodyUnknown`.

### Recovery

Persist only safe operation ID, entry method, phase, custody state, and correlation metadata in the operation ledger. Never persist credential material, dynamic secret input, PIN data, or authentication payload.

On startup, an unfinished operation enters custody reconciliation and blocks new work. Do not resume its customer Flow:

- If physical media was never acquired, close the operation as abandoned.
- If live device status confirms no media, record externally resolved custody and close it.
- If media remains, run only the card-return recovery flow.
- If status cannot be determined, enter terminal intervention.

All recovery records retain the original operation ID and audit correlation.

### UI and route boundary

Convert `apps/kiosk-example` into an interactive React application. React consumes the Zustand-backed `UiPort` and renders a safe `OperationViewState`. Components invoke commands and never hold Flow, XFS, DeviceRegistry, or InputSource sessions.

React Router remains an application adapter boundary with at least:

- `/kiosk` for customer interaction.
- `/diagnostics` for safe capability and health information.

Flow nodes are not URLs. Browser history cannot move a transaction between nodes. Leaving `/kiosk` interrupts active work and cleans operation resources but does not dispose the kiosk runtime or XFS service.

The UI must render at least idle entry selection, waiting for credential, validation failure, amount input, authentication, processing, take-card, completion, runtime failure, recovery, and terminal-intervention states.

### Readiness and availability

Runtime readiness describes whether the kiosk foundation can govern operations. Entry-method availability is calculated independently for each contribution.

In hostd mode:

- Contact card availability depends on its configured IDC, required authentication challenges, business services, and policy.
- QR availability depends on BCR and QR verification capabilities.
- Reservation availability depends on its feature flag and reservation business service, not XFS.

An unrelated unavailable entry method does not interrupt an active operation. Loss of a capability required by the current node does interrupt it. Diagnostics show safe transport, capability, logical-service, contribution-version, health, and last-check information.

### Prompt presentation

Add a focused prompt-presentation module containing:

- `PromptPresenter`.
- `RecordedPromptPort`.
- Browser recorded-audio adapter.
- `AudioAssetCatalog` with version and integrity metadata.
- Shared prompt priority, deduplication, queueing, and cancellation.

Flow and UI emit semantic prompt IDs and schema-validated safe parameters. They never pass arbitrary speech text, file paths, URLs, or binary audio.

TTS and recorded audio remain separate ports behind the presenter. Each catalog prompt explicitly chooses a policy such as recorded-required, recorded-preferred with allowed TTS fallback, TTS-required, visual-only, or visual-and-recorded. There is no implicit recorded-audio-to-TTS fallback.

TTS and recorded prompts share one audio lane. Safety prompts may preempt instructions. Node exit, interrupt, runtime reboot, and operation cleanup cancel current and queued presentation sessions. Repeated operation-view revisions do not replay the same prompt.

TTS is optional during ordinary visual operation but becomes required when the selected accessibility profile requires speech. Recorded assets declared required by bank policy participate in readiness. Asset replacement affects only a newly created runtime.

## Hostd Composition

The hostd-backed application must use registry and port lookup only:

- `@tripley-kit/xfs-client` is isolated inside `xfs-device-service`.
- `@tripley-kit/xfs-control-client` remains test-only inside the simulator harness.
- Business code and React do not import either client.
- Logical IDC, PIN, and BCR names come from configuration/discovery, never hard-coded core IDs.
- Hostd URL and optional auth come from validated runtime configuration.

The currently installed provider loaded from `K:\ATMdoc\dll` supports one complete XFS application cycle per hostd process and returns `-15` on a second cycle. The opt-in live suite must run once after a fresh hostd restart. This is an environment diagnostic, not a framework lifecycle rule.

## Implementation Order

1. Refactor oversized existing kiosk-base and any touched plugin-system modules without changing behavior.
2. Add kiosk-runtime contracts, registries, operation coordinator, policy resolution, readiness, and safe projection with deterministic tests.
3. Add prompt presentation contracts, browser adapter, asset catalog, and cancellation tests.
4. Extend XFS IDC port and fake clients with media-status and custody operations.
5. Implement memory-mode card, QR, reservation, PIN, and fake NFC contributions.
6. Build the interactive React application against ports and commands only.
7. Add hostd application composition and safe diagnostics.
8. Add deterministic browser tests.
9. Run the opt-in hostd/browser simulator contract once against a freshly restarted hostd.

## Acceptance Tests

Default tests must not require hostd, simulator, XFS DLLs, or network access. They must prove:

- Memory-mode card, QR, and reservation paths execute through registered contributions.
- A fake NFC plugin works without core modification.
- Unknown or policy-weak authentication requirements fail closed.
- Dynamic input bounds and safe validation feedback work.
- Business validation can reenter input while consuming attempt budget.
- Reentry does not reset the operation deadline.
- Duplicate start intents do not create concurrent operations.
- Competing entry methods are rejected during an active operation.
- Timeout, interrupt, route exit, and runtime reboot cancel active input and prompt sessions.
- Sensitive acquisition material is absent from UI state, scoped state, ledger, trace, hooks, audit, and logs.
- Secure PIN exposes only safe summaries and safe device output.
- Card custody prevents ordinary operation release until returned, retained, or escalated.
- Startup recovery never resumes customer business Flow.
- Recorded-prompt fallback follows per-prompt policy.
- Required audio/TTS capability affects readiness according to accessibility and bank policy.
- React consumes the UI adapter and command boundary rather than direct device clients.
- The example builds and typechecks.

The opt-in hostd/browser suite must prove:

- Clear guidance when hostd is unavailable or lacks required services.
- Configured/discovered IDC, PIN, and BCR logical services register successfully.
- Simulator automation performs IDC insert, read, eject, and take.
- Simulator automation completes online PIN without exposing plaintext.
- Simulator automation completes and cancels QR acquisition.
- Hostd device loss updates entry availability and interrupts only dependent work.
- The browser-visible operation projection follows the real WebSocket-backed path.

## Out of Scope

- CDM dispense, present, retract, and cash-unit accounting.
- A real NFC hardware adapter.
- CIM, PTR, and SIU workflows.
- Browser ownership of hostd or simulator processes.
- Runtime-mode hot swapping during an operation.
- Arbitrary remote Flow definitions, scripts, input profiles, audio URLs, or media payloads.
- Crash resume into credential, input, authentication, or business nodes.
- Production bank audio assets; banks provide approved assets through the catalog contribution contract.

## Decision References

- ADR 0002: Hostd mode fails fast instead of silently falling back.
- ADR 0003: Card and QR converge after acquisition.
- ADR 0004: The withdrawal operation owns device acquisition.
- ADR 0005: Sensitive acquisition material is transient.
- ADR 0006: Kiosk UI renders operation projections.
- ADR 0007: Entry and authentication methods are open contributions.
- ADR 0008: Local policy builds authentication plans.
- ADR 0009: One customer operation per kiosk runtime.
- ADR 0010: Kiosk runtime is a separate deep module.
- ADR 0011: XFS service lives for the kiosk runtime.
- ADR 0012: Customer media custody must be resolved.
- ADR 0013: Operations use deadlines and bounded interaction timeouts.
- ADR 0014: TTS speaks only policy-approved prompts.
- ADR 0015: Recorded prompts and TTS use one presenter.
- ADR 0016: Recovery reconciles custody without resuming Flow.
