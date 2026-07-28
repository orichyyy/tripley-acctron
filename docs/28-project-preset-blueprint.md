# 28. Project Preset and Blueprint System

## Purpose

Make industry project bases repeatable. A preset assembles required capabilities, plugins, configuration providers, windows, storage migrations, flow policies, command middleware, health checks, and UI contributions.

The runtime blueprint and the project source template are deliberately separate:

- `KioskProjectBlueprint` describes runtime capabilities and extension points.
- `templates/kiosk-project` defines the engineering constraints inherited by newly created bank projects.

Do not place source-generation concerns or agent instructions in the runtime blueprint interface.

## Project source template

Every new kiosk or bank project must start from:

```text
packages/create-kiosk-project/templates/AGENTS.md
```

The generated project may append project-specific rules, but it must retain the template's core-first architecture requirements.

Those requirements enforce:

- `apps/kiosk-example` as the reference composition.
- Existing Tripley Acctron packages before local implementation.
- Reusable framework gaps implemented in core with tests and documentation.
- Reference example updates for new reusable capabilities.
- Published public package interfaces as the project integration seam.
- Flow Engine ownership of business orchestration.
- UI ownership of presentation and user-intent submission only.
- Project-specific behavior implemented through registered extensions rather than core forks.

Project tooling that creates a kiosk application must materialize this file as the project-root `AGENTS.md`.

Initialize a new or existing project directory with:

```sh
pnpm dlx @tripley-kit/create-kiosk-project ./bank-kiosk
```

The command refuses to replace an existing `AGENTS.md`. An intentional replacement requires:

```sh
pnpm dlx @tripley-kit/create-kiosk-project ./bank-kiosk --force
```

This initial command creates governance only. It does not claim to generate a complete runtime application. Runtime scaffolding may be added later without changing the canonical instruction or collision-safety interfaces.

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

When work on a consuming bank project reveals a reusable missing capability, improve the corresponding core package first, update `apps/kiosk-example`, publish the package, and then consume the new version. Do not solve reusable framework gaps with project-local orchestration or copied implementations.
