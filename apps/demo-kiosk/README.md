# Demo Kiosk App

Vite React ATM demo for Tripley Acctron.

## Runtime

`src/demo/demo-runtime.ts` composes the browser demo runtime:

- `ReactUiAdapter` and `UiRuntimeStore` for framework UI contracts.
- `apps/atm-basic` flow and Recipe-based steps.
- fake devices, scenario host, transaction data, audit, recovery, TTS, voice guide, and windows.
- `transaction.start`, `transaction.reset`, and `transaction.status` command/query handlers from
  `@tripley-acctron/runtime-core`.

React components render screens and emit UI actions only. Validation, routing, transaction writes,
host calls, timeout, audit, recovery, and transaction lifecycle stay in the framework runtime.

## Screens

- `demo.welcome`: choose approved, declined, or failed fake host scenario.
- `account.input`: submit or cancel account input through the standard text input step.
- `demo.processing`: transient host request state.
- `demo.result`: final end route display.

## Commands

```sh
pnpm --filter @tripley-acctron/demo-kiosk run dev
pnpm --filter @tripley-acctron/demo-kiosk run build
pnpm run test -- apps/demo-kiosk/src/demo/demo-runtime.test.ts apps/demo-kiosk/src/App.test.tsx
```
