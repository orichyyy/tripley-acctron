# 01. Native SDK Adapter

## Purpose

Wrap `@tripley-kit/native` behind framework ports. Business code, plugins, Flow nodes, and UI adapters must not hold the raw `TripleyNative` object.

## Current SDK surface

Current SDK services are:

```text
runtime
fs
archive
tcp
websocket
sqlite
system
```

Current main methods:

```ts
native.connect(): Promise<void>
native.dispose(): Promise<void>
native.runtime.getInfo(): Promise<RuntimeInfo>
native.runtime.listCapabilities(): Promise<string[]>
```

SQLite, file system, archive, TCP, WebSocket, and power APIs are available. Native window/display/device/TTS/secure-storage APIs are not currently listed and therefore must be tracked as requirements.

## Adapter boundary

```ts
export interface NativePort {
  connect(): Promise<void>;
  dispose(): Promise<void>;

  getRuntimeInfo(): Promise<RuntimeInfo>;
  listCapabilities(): Promise<string[]>;
  requireCapabilities(capabilities: string[]): Promise<void>;

  fs: FrameworkFileSystemPort;
  archive: FrameworkArchivePort;
  tcp: FrameworkTcpPort;
  websocket: FrameworkWebSocketPort;
  sqlite: FrameworkSqlitePort;
  system: FrameworkSystemPort;

  extensions: NativeExtensionRegistry;
}
```

`NativePort.extensions` allows project plugins to attach temporary native bridges, for example a legacy kiosk RPC service exposing a new device before the official SDK adds it.

## Required capability policy

Confirmed behavior: all missing required capabilities fail fast.

```ts
await native.requireCapabilities([
  'runtime',
  'fs',
  'archive',
  'sqlite',
  'window.openWindow',
  'window.setAlwaysOnTop',
  'display.listDisplays'
]);
```

The adapter should distinguish three levels:

```text
service exists
method exists
feature exists within method
```

Because current `runtime.listCapabilities()` returns strings, richer capability metadata is recorded as `NATIVE-API-007`.

## Reconnect

Native reconnect policy is supported but default-off.

```ts
export interface NativeReconnectPolicy {
  enabled: boolean;
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier?: number;
  onReconnectFailed?: 'failApp' | 'enterMaintenance' | 'ignore';
}
```

Kiosk production can enable explicit reconnect, but the framework must not silently retry forever.

## Native extension adapter

```ts
export interface NativeExtensionAdapter {
  id: string;
  capabilities: string[];

  call<TRequest = unknown, TResponse = unknown>(
    method: string,
    request: TRequest,
    options?: NativeExtensionCallOptions
  ): Promise<TResponse>;

  onEvent?(
    handler: (event: NativeExtensionEvent) => void
  ): Subscription;
}
```

A project can use this bridge for a new device through WebSocket/RPC while the official native SDK is not ready. If the capability becomes reusable, it must be added to `docs/14-native-sdk-api-requirements.md`.

## Native event bridge

TCP/WebSocket native events are normalized into Event Bus topics:

```text
native.tcp.event
native.websocket.event
native.connection.changed
native.capability.missing
```

The bridge publishes event envelopes with `source='native'` and preserves `traceId` where possible.
