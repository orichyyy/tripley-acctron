# Web Container TypeScript Framework Design Spec

Version: 0.1.0  
Generated: 2026-06-30  
Target users: framework implementers, project-base developers, kiosk project developers, Codex coding agents.

This document set defines a TypeScript application framework for Web Container runtimes. It is designed for modern browser/WebView hosts, Electron, WebView2, and kiosk-style native containers. The framework isolates the host SDK behind adapters, provides a typed event bus, flow engine, native window management, plugin system, UI abstraction, configuration, logging, storage, command/action system, condition engine, device abstraction, and kiosk base best practices.

## Confirmed non-negotiable boundaries

- Native host windows are required for Window Manager. There is no `window.open` fallback for production window management.
- Missing required native capabilities fail fast.
- Plugin activation failure fails app startup.
- Flow instances start only through explicit `flowEngine.start(flowId, input)` in v1.
- Event Bus v1 does not automatically retry handlers; retry is owned by Flow Engine or explicit resilience policies.
- UI framework/router is abstracted. React adapter is first, React Router adapter is provided, but core does not depend on React Router.
- Logging follows `@tripley-kit/logger` JSON Lines app file log model.
- Native SDK missing API requirements are tracked in `docs/14-native-sdk-api-requirements.md`.
- Core must remain open: new devices, input sources, flow node kinds, effects, config providers, repositories, routes, conditions, command middleware, health checks, and native bridges must be added by plugin/registry without modifying core.

## Document map

| File | Purpose |
| --- | --- |
| `docs/00-overall-architecture.md` | Runtime, packages, dependency boundaries, startup/shutdown. |
| `docs/01-native-sdk-adapter.md` | Adapter over `@tripley-kit/native`, capabilities, reconnect. |
| `docs/02-event-bus.md` | Typed event bus, envelope, request/response, trace, dead-letter. |
| `docs/03-flow-engine.md` | Flow DSL, DAG, node types, policy, hooks, recovery, testing. |
| `docs/04-window-manager.md` | Native window manager, display layout, kiosk topology. |
| `docs/05-plugin-system.md` | Plugin manifest, lifecycle, dependencies, contributions. |
| `docs/06-ui-abstraction.md` | UI port, React/Zustand/React Router adapters, route/layout/menu. |
| `docs/07-project-base-and-kiosk-example.md` | Kiosk base preset, window topology, legacy coexistence. |
| `docs/08-security-permission-model.md` | Capability, permission, data classification, secret handling. |
| `docs/09-configuration-system.md` | Spring/.NET-style providers, writable config, SQLite KV. |
| `docs/10-logging-spec.md` | LoggerPort, `@tripley-kit/logger` integration, viewer guidance. |
| `docs/11-observability-error-handling.md` | Trace, error catalog, health and diagnostics. |
| `docs/12-storage-state-persistence.md` | Storage abstraction, SQLite, runtime store. |
| `docs/13-testing-strategy.md` | Vitest harness, mocks, contract tests. |
| `docs/14-native-sdk-api-requirements.md` | Required additions to native SDK. |
| `docs/15-codex-implementation-plan.md` | Suggested package build order for Codex. |
| `docs/16-kiosk-data-access-and-sqlite.md` | Transactions, messages, counter, configuration KV, Drizzle adapter. |
| `docs/17-command-action-system.md` | Prism-like command system and action pipeline. |
| `docs/18-condition-policy-engine.md` | Visible/enabled/canExecute and custom policies. |
| `docs/19-tts-service.md` | Browser TTS adapter and native TTS extension point. |
| `docs/20-kiosk-flow-best-practices.md` | Timeout, interrupt, cleanup, idempotency, user input. |
| `docs/21-scoped-store.md` | application/session/transaction/flow/node lifecycle store. |
| `docs/22-device-abstraction-layer.md` | Device registry, device locks, events, health. |
| `docs/23-user-input-node-and-device-input.md` | Pinpad/barcode/user input orchestration and extension. |
| `docs/24-extensibility-architecture.md` | Open extension contract and registry rules. |
| `docs/25-decision-record.md` | All confirmed decisions. |
| `docs/26-resilience-idempotency-outbox.md` | Resilience policies, operation ledger, idempotency, reliable outbox. |
| `docs/27-calendar-feature-localization-accessibility.md` | Clock, business calendar, feature flags, prompt catalog, accessibility. |
| `docs/28-project-preset-blueprint.md` | Project preset / blueprint assembly model. |

## Source SDK constraints used by this design

The current `@tripley-kit/native` SDK exposes runtime, fs, archive, tcp, websocket, sqlite, and system services only. Therefore window, display, device, pinpad, barcode reader, native TTS, native secure storage, and richer SQLite APIs are recorded as SDK API requirements rather than assumed as existing APIs.

The current `@tripley-kit/logger` app log model recommends JSON Lines, `JsonFormatter`, stable metadata fields such as `eventId`, `module`, `action`, and `traceId`, and viewer grouping by `metadata.eventId`.
