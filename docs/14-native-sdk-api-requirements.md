# 14. Native SDK API Requirements

## Purpose

Record APIs missing from the current Native SDK but required by the framework or likely project needs. This file must be maintained during development. Do not scatter SDK gaps across module docs.

## Status values

```text
proposed
accepted
blocked
implemented
deprecated
```

## Priority values

```text
P0 framework blocker
P1 required for first production project
P2 useful enhancement
P3 future consideration
```

## Current SDK baseline

Current available services are runtime, fs, archive, tcp, websocket, sqlite, and system. Current SDK does not list native window, display, TTS, or secure storage APIs.

CEN/XFS device operations are intentionally not tracked as Native SDK API proposals here. Device services should be wrapped from `@tripley-kit/xfs-client` through framework ports/adapters so application, Flow, Command, and UI code still depend on framework device abstractions instead of raw XFS clients.

---

## NATIVE-API-001 Native Window Management

Status: implemented  
Priority: P0  
Source module: Window Manager

```ts
native.window.openWindow(options)
native.window.closeWindow(windowId)
native.window.focusWindow(windowId)
native.window.showWindow(windowId)
native.window.hideWindow(windowId)
native.window.minimizeWindow(windowId)
native.window.restoreWindow(windowId)
native.window.listWindows()
native.window.getCurrentWindow()
native.window.onWindowEvent(handler)
```

Implemented through `@tripley-kit/native` container adapters. Tauri is provided by the SDK; Electron must inject a preload/main adapter that owns real BrowserWindow access.

## NATIVE-API-002 Display / Screen Enumeration

Status: implemented  
Priority: P0

```ts
native.display.listDisplays()
native.display.getPrimaryDisplay()
native.display.getDisplayById(displayId)
native.display.onDisplayEvent(handler)
```

Return `id`, `index`, `isPrimary`, `bounds.x/y/width/height`, workArea, scaleFactor, rotation, touchSupport.

Implemented through container adapters. Tauri maps monitor information from `@tauri-apps/api/window`; Electron must inject a display adapter.

## NATIVE-API-003 Window Placement

Status: implemented  
Priority: P0

```ts
native.window.setWindowBounds(windowId, bounds)
native.window.moveWindowToDisplay(windowId, displayId, options)
```

## NATIVE-API-004 Window Z-order / Always-on-top

Status: implemented  
Priority: P0

```ts
native.window.setWindowAlwaysOnTop(windowId, true | false)
```

Needed to coexist with legacy kiosk systems.

## NATIVE-API-005 Window Visibility Control

Status: implemented  
Priority: P0

```ts
native.window.showWindow(windowId)
native.window.hideWindow(windowId)
native.window.minimizeWindow(windowId)
native.window.restoreWindow(windowId)
```

## NATIVE-API-006 Window Lifecycle Events

Status: implemented  
Priority: P1

Events: opened, ready, focused, blurred, hidden, shown, minimized, restored, closed, crashed, boundsChanged, displayChanged, alwaysOnTopChanged.

## NATIVE-API-007 Capability Detail

Status: implemented  
Priority: P1

```ts
native.runtime.getCapabilityDetails(): Promise<NativeCapabilityDetail[]>
```

```ts
interface NativeCapabilityDetail {
  name: string;
  available: boolean;
  version?: string;
  reason?: string;
  features?: Record<string, boolean>;
}
```

## NATIVE-API-008 SQLite parameterized/callback transaction

Status: implemented  
Priority: P1

```ts
sqlite.transaction<T>(fn: (tx: SqliteTransaction) => Promise<T>): Promise<T>
```

Needed for atomic counters and operation ledger.

Implemented as a TypeScript facade callback transaction over one SQLite connection: `BEGIN IMMEDIATE`, callback operations, `COMMIT`, and `ROLLBACK` on error.

## NATIVE-API-009 SQLite batch query with params and return values

Status: implemented  
Priority: P2

```ts
sqlite.batch(queries: Array<{ sql: string; params?: SqliteValue[]; method: 'run' | 'get' | 'all' | 'values' }>): Promise<SqliteBatchResult[]>
```

## NATIVE-API-010 SQLite raw query result

Status: implemented  
Priority: P2

```ts
sqlite.queryRaw(sql: string, params?: SqliteValue[]): Promise<{ columns: string[]; rows: SqliteValue[][] }>
```

Key requirement for production-ready Drizzle proxy adapter.

## NATIVE-API-011 Native TTS Service

Status: implemented  
Priority: P2

```ts
native.tts.speak(text, options)
native.tts.stop()
native.tts.pause()
native.tts.resume()
native.tts.listVoices()
native.tts.onEvent(handler)
```

Browser `speechSynthesis` is default v1 implementation.

Implemented as the default fallback adapter.

## NATIVE-API-012 Native Secure Storage

Status: implemented  
Priority: P1

```ts
native.secureStorage.get(key)
native.secureStorage.set(key, value)
native.secureStorage.remove(key)
native.secureStorage.list(prefix?)
```

Needed for secrets beyond v1 insecure SQLite fallback.

Implemented as an in-memory fallback adapter. Projects that need OS-backed secrets should inject a stronger secure storage adapter.
