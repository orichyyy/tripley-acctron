# 28. Project Preset and Blueprint System

## Purpose

Make industry project bases repeatable. A preset assembles required capabilities, plugins, configuration providers, windows, storage migrations, flow policies, command middleware, health checks, and UI contributions.

## ProjectPreset

```ts
export interface ProjectPreset {
  id: string;
  name: string;
  version: string;
  requiredNativeCapabilities: string[];
  optionalNativeCapabilities?: string[];
  plugins: PluginModule[];
  configuration: ConfigurationPreset;
  logging: LoggingPreset;
  storage: StoragePreset;
  windows: WindowLayoutPreset;
  flowPolicies: FlowPolicyPreset;
  commandMiddleware: CommandMiddleware[];
  conditionPacks?: ConditionPack[];
  promptPacks?: PromptPack[];
  healthChecks: HealthCheck[];
  routes?: RouteContribution[];
  layouts?: LayoutContribution[];
}
```

## Blueprint assembly

```ts
export function createRuntimeFromPreset(preset: ProjectPreset, overrides: ProjectOverrides): Promise<FrameworkRuntime>;
```

Assembly steps:

```text
1. Validate preset schema.
2. Connect native.
3. Check required native capabilities.
4. Load configuration providers and overrides.
5. Initialize logger.
6. Run storage migrations.
7. Register plugins and contributions.
8. Register preset conditions, prompts, command middleware, health checks.
9. Initialize windows/display mapping.
10. Activate plugins.
11. Mark runtime ready.
```

## Kiosk bank preset example

```ts
export const kioskBankPreset: ProjectPreset = {
  id: 'preset.kiosk.bank',
  name: 'Bank Kiosk Preset',
  version: '1.0.0',
  requiredNativeCapabilities: [
    'runtime',
    'fs',
    'archive',
    'sqlite',
    'window.openWindow',
    'window.setAlwaysOnTop',
    'window.minimizeWindow',
    'display.listDisplays'
  ],
  optionalNativeCapabilities: ['tts', 'device.barcodeReader'],
  plugins: [],
  configuration: { providerOrder: ['cli', 'env', 'sqlite', 'json', 'defaults'] },
  logging: { filename: '/logs/app_{{yyyyMMdd}}.log', maxFiles: 14 },
  storage: { sqlitePath: '/data/kiosk.db', migrations: ['framework', 'kiosk-base'] },
  windows: { topology: 'project-configured' },
  flowPolicies: {
    userInputTimeout: { timeoutMs: 30_000 },
    interrupts: ['card.removed', 'headphone.removed.blindMode']
  },
  commandMiddleware: [],
  healthChecks: []
};
```

## Project overrides

Overrides may come from project code, JSON file, environment, CLI, SQLite device config, or admin setup.

```ts
export interface ProjectOverrides {
  configuration?: Partial<ConfigurationPreset>;
  windows?: Partial<WindowLayoutPreset>;
  plugins?: PluginModule[];
  requiredNativeCapabilities?: string[];
}
```

## Codex guidance

Implement preset assembly only after core registries, configuration, logging, native adapter, event bus, plugin system, and storage migrations exist. Preset should not bypass public registries.
