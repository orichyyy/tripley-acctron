# Tripley Acctron

TypeScript kiosk framework MVP for Tripley Acctron. The implementation follows
`docs/kiosk-ts-framework-design.md` and keeps contracts, runtime, flow, testing, native, and UI code
in separate packages.

## Packages

- `@tripley-acctron/contracts`: public interfaces and shared types.
- `@tripley-acctron/event-bus`: typed event, command, and query buses.
- `@tripley-acctron/plugin-system`: service registry, lifecycle, and plugin runtime.
- `@tripley-acctron/runtime-core`: `createKioskApp` runtime composition.
- `@tripley-acctron/flow-engine`: flow compiler, step scope, timeout, interaction runtime, standard
  step builders, and transaction recovery.
- `@tripley-acctron/testing`: headless UI, async fake devices, recovery wiring, fake host, and
  virtual clock.
- `@tripley-acctron/native`: adapter over `@tripley-kit/native`.
- `@tripley-acctron/react-ui`: minimal React `UiPort` adapter.
- `apps/demo-kiosk`: Vite React demo shell.

## Commands

```sh
pnpm install
pnpm run check
pnpm --filter @tripley-acctron/demo-kiosk run dev
```

## Native Policy

All native calls must go through `@tripley-kit/native` and the adapter in `packages/native`.
Do not call Tauri, Electron, or WebView invoke APIs directly from business or framework code.
Missing native capabilities are tracked in `docs/native-required-capabilities.md`.

## Documentation Rule

When adding a feature, important update, or fix:

- update the affected package or app README;
- record user-visible or contract-level changes in `docs/changelog.md`;
- record missing native requirements in `docs/native-required-capabilities.md`.
