# 07. Project Base and Kiosk Example

## Purpose

A project base is a reusable industry layer. For kiosk, it includes runtime preset, plugin bundle, project template, storage migrations, default command middleware, default flow policies, health checks, UI layouts, device contracts, and examples.

## Project preset

```ts
export interface ProjectPreset {
  id: string;
  version: string;
  requiredNativeCapabilities: string[];
  plugins: PluginModule[];
  configuration: ConfigurationPreset;
  logging: LoggingPreset;
  storage: StoragePreset;
  windows: WindowLayoutPreset;
  flowPolicies: FlowPolicyPreset;
  commandMiddleware: CommandMiddleware[];
  healthChecks: HealthCheck[];
}
```

## Kiosk base capabilities

Core kiosk base includes:

- Window topology policy.
- Display role mapping setup.
- Device abstraction layer.
- Audit Journal / EJ.
- Transaction repository.
- Transaction message repository.
- Command/action system defaults.
- Condition engine defaults.
- TTS port default browser implementation.
- User input node device orchestration.
- ScopedStore lifecycle reset hooks.
- Business calendar/clock.
- Feature flags.
- Localization / prompt catalog.
- Accessibility service.
- Health check center.
- Error catalog.
- Optional outbox / reliable message module.

## Single-screen default

```ts
export const singleScreenKioskConfig = {
  topology: 'single-screen',
  windowMode: 'single-root-route-switch',
  rootWindows: {
    main: {
      windowKey: 'kiosk.main',
      path: '/customer/idle',
      displayRole: 'front',
      launch: 'onBoot',
      features: { fullscreen: true, frame: false, resizable: false, alwaysOnTop: false }
    }
  }
};
```

## Multi-screen project config

```ts
export const multiScreenKioskConfig = {
  topology: 'multi-screen',
  windowMode: 'dedicated-root-per-display',
  displayRoles: {
    front: { required: true, source: 'device-config-or-admin-selection' },
    rear: { required: false, source: 'device-config-or-admin-selection' },
    top: { required: false, source: 'device-config-or-admin-selection' }
  },
  rootWindows: {
    customer: { windowKey: 'kiosk.customer', path: '/customer/idle', displayRole: 'front', launch: 'onBoot' },
    admin: { windowKey: 'kiosk.admin', path: '/admin', displayRole: 'rear', launch: 'onDemand' },
    advertising: { windowKey: 'kiosk.advertising', path: '/advertising', displayRole: 'top', launch: 'onBoot' }
  }
};
```

## Legacy coexistence flow pattern

The legacy kiosk may notify the app via WebSocket/RPC. The app then uses a flow to bring its customer window to front, run transaction, and release screen.

```text
legacy message -> command/handler -> flowEngine.start('kiosk.legacy.transaction')
```

Release behavior is chosen by the flow: cancel always-on-top + minimize, hide, close, or navigate idle.

## Best-practice project layering

```text
framework core
  -> kiosk base preset
    -> bank project base plugin bundle
      -> branch/device-specific configuration
        -> deployment/device runtime config
```
