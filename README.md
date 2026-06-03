# Tripley Acctron

TypeScript kiosk application foundation for ATM, hospital, aviation, and similar managed devices.
The core is UI-framework independent and can run in headless tests before integration with Tauri,
Electron, or WebView2 containers.

## Workspace

| Package | Responsibility |
| --- | --- |
| `@tripley-acctron/contracts` | Framework-neutral ports, state types, and runtime config validation |
| `@tripley-acctron/event-bus` | Type-safe critical and best-effort event publication |
| `@tripley-acctron/plugin-system` | Static plugin lifecycle and dependency injection registry |
| `@tripley-acctron/runtime-core` | Service availability, transaction recovery, and step timeout handling |
| `@tripley-acctron/host` | Extensible host message contracts and HTTP+JSON transport |
| `@tripley-acctron/window-coordinator` | Main-runtime authority and supervisor messaging contract |
| `@tripley-acctron/accessibility` | Browser TTS and locale-aware voice guide adapters |
| `@tripley-acctron/observability` | Customer interaction logging and electronic journal dual-write |
| `@tripley-acctron/flow-engine` | Placeholder contract for the future custom FlowEngine |
| `@tripley-acctron/testing` | Memory adapters and deterministic fake clock |

The current native IDL gaps are tracked in
[`docs/native-capability-requirements.md`](./docs/native-capability-requirements.md).

## Commands

```sh
pnpm install
pnpm check
```

Use `pnpm format` to apply Biome formatting. New features, important changes, and fixes must update
[`CHANGELOG.md`](./CHANGELOG.md) and the relevant package README.

