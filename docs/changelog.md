# Changelog

## 0.1.0

- Added framework MVP package structure.
- Added typed event, command, and query buses.
- Added plugin runtime, service registry, lifecycle registry, and runtime app composition.
- Added FlowEngine MVP with StepScope and raw steps.
- Added headless testing helpers and fake devices.
- Added `@tripley-kit/native` adapter package.
- Added Vite React demo shell using Tailwind and shadcn-style components.
- Added timeout contracts, `SystemClock`, `DefaultTimeoutService`, and cancellable `VirtualClock`.
- Added interaction contracts, `InputSources`, and `InteractionRuntime`.
- Added async fake pinpad/barcode input support for headless interaction tests.
- Added Standard Step Kit builders for text input, choice, confirm, host request skeleton, and wait
  device skeleton.
- Added card reader, cash dispenser, printer, status, lease, and recovery contracts.
- Added transaction resource registry and default recovery manager.
- Added flow recovery hooks for unhandled step errors and normal flow completion.
- Expanded testing fake devices and test app recovery wiring.
- Added Host Gateway contracts, default JSON host runtime, fake host gateway, and HostRequestStep
  gateway integration.
- Added Electronic Journal, redaction, and interaction audit contracts.
- Added in-memory Electronic Journal, default redaction, and default interaction audit service.
- Wired Standard Step Kit text input, choice, and confirm steps to write prompt/input/choice audit
  records to logger and EJ.
- Expanded test app observability wiring and redaction/audit coverage.
- Added Milestone 10 contracts for transaction data, TTS, voice guide, audio assets, and window
  management.
- Added `@tripley-acctron/recipes` with `inputAccount`, `waitCardInserted`, and `ejectCard`.
- Added `@tripley-acctron/accessibility` with noop/browser TTS, voice guide, asset resolver, and
  audio players.
- Added `@tripley-acctron/window-coordinator` with headless window manager and native skeleton.
- Expanded testing app wiring with transaction, TTS, voice guide, and window manager defaults.
- Added `apps/atm-basic` Recipe-based ATM transaction example.
- Added Step Policy Runtime for standard steps, centralizing prompt audit, optional voice guide,
  optional TTS, failed route logging, and cancel/timeout route defaults.
- Moved `Recipes.inputAccount` voice guide playback to prompt start instead of successful commit.
- Upgraded `apps/demo-kiosk` into a React ATM demo wired to `apps/atm-basic`, `ReactUiAdapter`,
  fake devices, fake host scenarios, transaction data, audit, recovery, and result screens.
- Added demo runtime and React smoke tests, and expanded Vitest to include app `.test.tsx` files.
- Added transaction lifecycle contracts, cancellable `FlowEngine.run`, and runtime-core
  transaction command/query controller.
- Switched the React ATM demo orchestration to transaction lifecycle commands and added reset
  cancellation coverage.
