# 15. Codex Implementation Plan

## Goal

Build the framework incrementally with strong contracts first, then adapters and kiosk base modules.

## Tooling

- pnpm workspaces.
- tsup for packages.
- Vite for example/project apps.
- Biome for lint/format.
- Vitest for tests.
- Package names: `@tripley-kit/web-container-*`.

## Phase 0: repo skeleton

Create monorepo packages with strict TypeScript configs:

```text
packages/core
packages/event-bus
packages/native-adapter
packages/logging
packages/configuration
packages/storage-core
packages/storage-sqlite
packages/plugin-system
packages/flow-engine
packages/ui-port
packages/react-adapter
packages/window-manager
packages/command-system
packages/condition-engine
packages/device-core
packages/scoped-store
packages/tts
packages/kiosk-base
packages/testing
apps/kiosk-example
```

## Phase 1: contracts and registries

Implement open registry infrastructure:

- ServiceRegistry
- ExtensionRegistry
- Plugin registry
- EventBus contracts
- LoggerPort
- Configuration contracts
- NativePort contracts
- DeviceRegistry
- FlowNodeExecutorRegistry
- InputSourceRegistry
- EffectRunnerRegistry

Do not implement business logic before contracts are stable.

## Phase 2: logging, config, native adapter

- `@tripley-kit/native` adapter.
- Capability check.
- `@tripley-kit/logger` adapter.
- Config providers: defaults, JSON, env, CLI, SQLite.
- Bootstrap startup order.

## Phase 3: Event Bus and observability

- Local transport.
- BroadcastChannel transport.
- Request/response.
- Dead-letter.
- Memory trace.
- Logger integration.

## Phase 4: storage

- SQLite connection wrapper.
- Migration runner.
- CounterService.
- Config KV provider.
- Operation ledger skeleton.

## Phase 5: Flow Engine

- Definition registry.
- Node executor registry.
- Built-in node executors.
- Hooks/middleware.
- User input node skeleton.
- Timeout/interrupt policies.
- FlowStore memory.
- Flow testing runner.

## Phase 6: plugin system

- Manifest validation.
- Dependency resolver.
- Install/register/activate/deactivate/dispose.
- Contribution registries.
- Contract tests.

## Phase 7: UI adapter

- UiPort.
- Zustand state adapter.
- React Router adapter.
- Route/layout/menu registry.
- CommandButton/useCommand.

## Phase 8: window/display manager

Implement contract and mock first. Native implementation awaits SDK APIs.

## Phase 9: kiosk base

- Transaction repository.
- Transaction message repository.
- Audit Journal/EJ.
- Command middleware.
- Condition library.
- Device abstractions.
- User input source adapters.
- TTS browser adapter.
- ScopedStore hooks.
- Kiosk example app.

## Phase 10: optional adapters

- Drizzle proxy adapter.
- Native TTS adapter.
- Native device adapter.
- Outbox.
- Diagnostics bundle.

## Guardrails for Codex

- Do not import raw `@tripley-kit/native` outside native-adapter package.
- Do not import `@tripley-kit/logger` outside logging package.
- Do not add switch/case on closed device/input/node kinds in core executors.
- Built-ins must register through the same public registries as plugin contributions.
- Every public extension kind must allow `string & {}` and/or module augmentation.
- Add contract tests before implementing adapters.
