# 05. Plugin System

## Purpose

Plugins contribute services, UI, routes, layouts, commands, conditions, flows, node handlers, device adapters, input sources, storage migrations, config schema, health checks, native extension adapters, and project presets.

## Decisions

- Plugin types: service, UI, flow, native adapter, project preset, device, storage, condition, command.
- Loading: static and dynamic import supported; v1 primarily static import.
- Manifest: full declaration of events, services, routes, flows, capabilities, dependencies, compatibility, permissions.
- Lifecycle: install, register, activate, deactivate, dispose.
- Dependencies: required and optional with version ranges.
- Services: typed service registry and Event Bus request/response.
- UI: route + component + navigation contribution.
- Flow: flow definition and node handler contribution.
- Config: project config + runtime/device config + env override.
- Isolation: v1 logical isolation through context/ports; iframe/worker reserved.
- Permission v1: manifest declaration with warning/trace, no hard enforcement.
- Activate failure: app startup fails.
- Kiosk base: runtime preset + plugin bundle + project template.

## Manifest

```ts
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  type: PluginType[];
  compatibility?: {
    frameworkVersion?: string;
    projectBase?: string[];
    nativeCapabilities?: string[];
  };
  dependencies?: {
    required?: Record<string, string>;
    optional?: Record<string, string>;
  };
  permissions?: {
    native?: string[];
    devices?: string[];
    inputSources?: string[];
    events?: { publishes?: string[]; subscribes?: string[] };
    storage?: string[];
    windows?: string[];
  };
  contributes?: {
    services?: ServiceContribution[];
    routes?: RouteContribution[];
    layouts?: LayoutContribution[];
    navigation?: NavigationContribution[];
    flows?: FlowContribution[];
    flowNodeHandlers?: FlowNodeHandlerContribution[];
    flowNodeExecutors?: FlowNodeExecutorContribution[];
    effectRunners?: EffectRunnerContribution[];
    commands?: CommandContribution[];
    commandMiddleware?: CommandMiddlewareContribution[];
    conditions?: ConditionContribution[];
    validators?: ValidatorContribution[];
    devices?: DeviceContribution[];
    inputSources?: InputSourceContribution[];
    configProviders?: ConfigurationProviderContribution[];
    configSchema?: ConfigSchemaContribution[];
    migrations?: MigrationContribution[];
    repositories?: RepositoryContribution[];
    healthChecks?: HealthCheckContribution[];
    nativeExtensions?: NativeExtensionContribution[];
  };
}
```

## Lifecycle

```ts
export interface PluginModule {
  manifest: PluginManifest;
  install?(ctx: PluginInstallContext): Promise<void> | void;
  register?(ctx: PluginRegisterContext): Promise<void> | void;
  activate?(ctx: PluginActivateContext): Promise<void> | void;
  deactivate?(ctx: PluginDeactivateContext): Promise<void> | void;
  dispose?(ctx: PluginDisposeContext): Promise<void> | void;
}
```

`register` must be side-effect-light and register contributions. `activate` starts runtime subscriptions, devices, listeners, and services.

## Plugin context

```ts
export interface PluginRuntimeContext {
  appId: string;
  projectId: string;
  pluginId: string;
  eventBus: EventBus<any>;
  config: Configuration;
  logger: LoggerPort;
  services: ServiceRegistry;
  flows: FlowRegistry;
  ui: UiContributionRegistry;
  native: NativePort;
  windows: WindowPort;
  devices: DeviceRegistry;
  inputSources: InputSourceRegistry;
  commands: CommandRegistry;
  conditions: ConditionRegistry;
  storage: StorageRegistry;
  extensions: FrameworkExtensionRegistry;
}
```

## Failure policy

Required plugin activate failure fails app startup. Optional plugins must be explicitly marked optional by the project preset.

## Open extension rule

Built-in plugins use the same manifest and registry path as project plugins. Core must not special-case built-in plugins.
