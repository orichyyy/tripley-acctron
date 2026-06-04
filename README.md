# Tripley Acctron

TypeScript kiosk framework MVP for Tripley Acctron. The implementation follows
`docs/kiosk-ts-framework-design.md` and keeps contracts, runtime, flow, testing, native, and UI code
in separate packages.

## Packages

- `@tripley-acctron/contracts`: public interfaces and shared types.
- `@tripley-acctron/event-bus`: typed event, command, and query buses.
- `@tripley-acctron/plugin-system`: service registry, lifecycle, and plugin runtime.
- `@tripley-acctron/runtime-core`: `createKioskApp` runtime composition and transaction lifecycle
  command controller.
- `@tripley-acctron/flow-engine`: flow compiler, step scope, timeout, interaction runtime, standard
  step builders, step policy, audit integration, and transaction recovery.
- `@tripley-acctron/host`: Host Gateway runtime, JSON codec, and canonical message mapper.
- `@tripley-acctron/recipes`: business-level recipes for common ATM steps.
- `@tripley-acctron/accessibility`: TTS, voice guide, audio asset resolution, and audio players.
- `@tripley-acctron/window-coordinator`: window manager port implementations and native skeleton.
- `@tripley-acctron/testing`: headless UI, async fake devices, recovery wiring, fake host, and
  observability, accessibility, window, transaction wiring, and virtual clock.
- `@tripley-acctron/native`: adapter over `@tripley-kit/native`.
- `@tripley-acctron/react-ui`: React `UiPort` adapter and runtime store for browser screens.
- `apps/atm-basic`: basic ATM transaction flow built with Recipes.
- `apps/demo-kiosk`: Vite React ATM demo wired to `apps/atm-basic`.

## Commands

```sh
pnpm install
pnpm run check
pnpm --filter @tripley-acctron/demo-kiosk run dev
```

The demo app runs the Recipe-based ATM flow in the browser with fake devices, fake host scenarios,
React UI actions, audit, transaction data, recovery, transaction lifecycle commands, and the
standard step policy runtime.

## Native Policy

All native calls must go through `@tripley-kit/native` and the adapter in `packages/native`.
Do not call Tauri, Electron, or WebView invoke APIs directly from business or framework code.
Missing native capabilities are tracked in `docs/native-required-capabilities.md`.

## Documentation Rule

When adding a feature, important update, or fix:

- update the affected package or app README;
- record user-visible or contract-level changes in `docs/changelog.md`;
- record missing native requirements in `docs/native-required-capabilities.md`.
