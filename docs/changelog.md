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
