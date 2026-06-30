# 24. Extensibility Architecture

## Purpose

Ensure project requirements do not become impossible because core used closed enums, hardcoded switches, or hidden special cases.

## Extension rules

```text
RULE-EXT-001 Public API kinds/types/names used by project/plugin extension must not be closed enums.
RULE-EXT-002 Built-in capabilities must register through the same registry as project capabilities.
RULE-EXT-003 Core depends on abstract ports, not project plugins, device plugins, React Router, Drizzle, or raw device APIs.
RULE-EXT-004 Registration validates required adapters/capabilities/plugins fail fast.
RULE-EXT-005 Optional capabilities must be skippable through enabledWhen / condition / feature flag.
RULE-EXT-006 Extensions can declare schema and are validated at startup/registration.
RULE-EXT-007 Extensions declare dataClassification and safeSummary behavior.
RULE-EXT-008 Extensions receive LoggerPort, EventBus, Configuration, ScopedStore, Clock, and registries through context.
RULE-EXT-009 Registries track ownerPluginId, version, priority, duplicate policy, and dispose.
RULE-EXT-010 Testing Harness provides extension contract tests.
```

## Registry matrix

| Module | Extension point | Mechanism |
| --- | --- | --- |
| Native Adapter | Native extension bridge | `NativeExtensionRegistry` |
| Device Layer | new device type | `DeviceRegistry` |
| UserInputNode | new input source | `InputSourceRegistry` |
| Flow Engine | new node kind | `FlowNodeExecutorRegistry` |
| Flow Engine | new effect kind | `EffectRunnerRegistry` |
| Flow Engine | new policy | `FlowPolicyRegistry` |
| Command | new command/middleware | `CommandRegistry` / middleware |
| Condition | new condition | `ConditionRegistry` |
| UI | route/layout/menu/guard | UI contribution registry |
| Config | new provider | `ConfigurationProviderRegistry` |
| Storage | repository/migration | `RepositoryRegistry` / `MigrationRunner` |
| Logging | metadata enrichment | `LogEnricherRegistry` |
| Health | health check | `HealthCheckRegistry` |
| Plugin | project preset | `ProjectPreset` |

## Generic registry contract

```ts
export interface ExtensionRegistration<T> {
  id: string;
  version?: string;
  ownerPluginId?: string;
  priority?: number;
  duplicatePolicy?: 'reject' | 'replace' | 'ignore' | 'chain';
  value: T;
  dispose?: () => void | Promise<void>;
}
```

## Open TypeScript kinds

Use known types plus open string:

```ts
export type BuiltinFlowNodeKind = 'action' | 'userInput' | 'waitEvent' | 'decision' | 'parallel' | 'race' | 'subflow' | 'terminal';
export type FlowNodeKind = BuiltinFlowNodeKind | (string & {});
```

For strong project typing, use module augmentation maps:

```ts
export interface UserInputSourceMap {
  'pinpad.data': { options: PinpadDataInputOptions; result: PlainInputResult };
  'pinpad.pin': { options: PinpadPinInputOptions; result: SecurePinInputResult };
}
```

Project plugin:

```ts
declare module '@tripley/web-container-flow-engine' {
  interface UserInputSourceMap {
    'bank.idCardReader.identity': { options: IdCardReaderInputOptions; result: IdCardReaderInputResult };
  }
}
```

## No switch/case special casing

Avoid:

```ts
switch (source.kind) {
  case 'pinpad.data': ...
}
```

Use:

```ts
const adapter = ctx.inputSources.get(source.kind);
const session = await adapter.start(ctx, source);
```

## Native extension path

When official native SDK does not yet support a device, a project plugin can bridge through WebSocket/RPC:

```ts
ctx.native.extensions.register({
  id: 'bank.deviceHost',
  capabilities: ['device.idCardReader'],
  call: async (method, request) => legacyRpc.call(method, request),
  onEvent: handler => legacyRpc.onEvent(handler)
});
```

Then the project registers a typed DevicePort and InputSourceAdapter.

## Contract tests

Every adapter type should have contract tests, and built-ins must pass the same tests as project extensions.
