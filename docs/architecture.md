# Architecture

Tripley Acctron follows the kiosk TypeScript framework design in `docs/kiosk-ts-framework-design.md`.

The V1 implementation is a framework MVP:

- `contracts` defines public interfaces before implementation.
- `event-bus`, `plugin-system`, and `runtime-core` provide the application kernel.
- `flow-engine` owns flow graph execution and step lifecycle boundaries.
- Timeout and cancellation are framework infrastructure: `DefaultTimeoutService` uses the shared
  `Clock` contract, supports More Time dialogs through `UiPort`, and can be tied to a step
  `AbortSignal`.
- `testing` supplies headless UI, fake devices, and deterministic clock helpers.
- `native` adapts `@tripley-kit/native`; app code must not use container invoke strings directly.
- `react-ui` and `apps/demo-kiosk` provide a minimal React UI surface for V1 demo visibility.

Feature additions, important fixes, and contract changes must update the relevant package README and `docs/changelog.md`.
