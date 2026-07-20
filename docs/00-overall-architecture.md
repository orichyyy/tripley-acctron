# 00. Overall Architecture

## Goals

Design a TypeScript framework that runs inside Web Container-style runtimes and supports industry project bases such as kiosk systems. The framework must provide durable architectural primitives so project developers can build plugins and flows without depending on a specific UI framework, router, or raw native SDK object.

## Runtime model

The runtime can run in:

- Chrome-like browser container.
- Electron.
- WebView2.
- Mobile WebView.
- Native kiosk WebView.
- WebSocket-connected host daemon mode.

The framework treats the native host as a capability provider. Application code and plugins depend on framework ports, not on raw native SDK services.

## Monorepo package topology

```text
packages/
  core/
  native-adapter/
  event-bus/
  flow-engine/
  window-manager/
  plugin-system/
  ui-port/
  react-adapter/
  configuration/
  logging/
  observability/
  storage-core/
  storage-sqlite/
  command-system/
  condition-engine/
  tts/
  scoped-store/
  device-core/
  kiosk-base/
  testing/
  examples/
```

Package naming uses `@tripley-kit/web-container-*`.

## Dependency rules

- `core` may depend only on pure contracts and minimal utilities.
- `native-adapter` depends on `@tripley-kit/native`.
- `logging` depends on `@tripley-kit/logger` but exposes `LoggerPort`.
- `flow-engine` depends on event bus, ports, policies, and registries; it does not depend on React or raw native SDK.
- `ui-port` defines contracts; `react-adapter` implements them.
- `kiosk-base` depends on framework packages and contributes preset/plugins/migrations/flows.
- Project plugins depend on ports and registries, not on internal framework implementation.

## Startup sequence

Confirmed sequence:

```text
1. Bootstrap minimal console logger.
2. Native SDK connect.
3. Config load.
4. Formal logger initialization.
5. Event Bus initialization.
6. Storage initialization and migrations.
7. Plugin install/register.
8. UI route/layout/menu registration.
9. Window creation/placement.
10. Plugin activate.
11. Flow registry ready.
12. App ready.
```

The user confirmed `Native SDK connect -> config load -> logger -> event bus -> plugins -> windows -> flows`. The implementation may use a temporary console logger before the formal logger because formal native file logging depends on configuration and native fs capability.

## Shutdown sequence

```text
1. Stop or cancel running flows.
2. Deactivate plugins.
3. Close windows.
4. Flush and close logger.
5. Dispose native adapter.
6. Dispose remaining registries.
```

## Failure policy

- Missing required native capability: fail fast.
- Missing optional capability: only allowed when the feature is truly optional and guarded by condition/feature flag.
- Plugin activate failure: fail app startup.
- Invalid flow definition: fail registration.
- Invalid project preset: fail boot.

## Open extension principle

Core must define contracts and registries. Built-in capabilities are registered through the same registry path as project capabilities. A project must be able to add a new input device, flow node kind, effect kind, repository, condition, command middleware, config provider, UI route, layout, or native extension without modifying core.
