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

Current available services are runtime, fs, archive, tcp, websocket, sqlite, and system. Current SDK does not list native window, display, TTS, secure storage, pinpad, barcode reader, or general device APIs.

---

## NATIVE-API-001 Native Window Management

Status: proposed  
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

## NATIVE-API-002 Display / Screen Enumeration

Status: proposed  
Priority: P0

```ts
native.display.listDisplays()
native.display.getPrimaryDisplay()
native.display.getDisplayById(displayId)
native.display.onDisplayEvent(handler)
```

Return `id`, `index`, `isPrimary`, `bounds.x/y/width/height`, workArea, scaleFactor, rotation, touchSupport.

## NATIVE-API-003 Window Placement

Status: proposed  
Priority: P0

```ts
native.window.setWindowBounds(windowId, bounds)
native.window.moveWindowToDisplay(windowId, displayId, options)
```

## NATIVE-API-004 Window Z-order / Always-on-top

Status: proposed  
Priority: P0

```ts
native.window.setWindowAlwaysOnTop(windowId, true | false)
```

Needed to coexist with legacy kiosk systems.

## NATIVE-API-005 Window Visibility Control

Status: proposed  
Priority: P0

```ts
native.window.showWindow(windowId)
native.window.hideWindow(windowId)
native.window.minimizeWindow(windowId)
native.window.restoreWindow(windowId)
```

## NATIVE-API-006 Window Lifecycle Events

Status: proposed  
Priority: P1

Events: opened, ready, focused, blurred, hidden, shown, minimized, restored, closed, crashed, boundsChanged, displayChanged, alwaysOnTopChanged.

## NATIVE-API-007 Capability Detail

Status: proposed  
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

Status: proposed  
Priority: P1

```ts
sqlite.transaction<T>(fn: (tx: SqliteTransaction) => Promise<T>): Promise<T>
```

Needed for atomic counters and operation ledger.

## NATIVE-API-009 SQLite batch query with params and return values

Status: proposed  
Priority: P2

```ts
sqlite.batch(queries: Array<{ sql: string; params?: SqliteValue[]; method: 'run' | 'get' | 'all' | 'values' }>): Promise<SqliteBatchResult[]>
```

## NATIVE-API-010 SQLite raw query result

Status: proposed  
Priority: P2

```ts
sqlite.queryRaw(sql: string, params?: SqliteValue[]): Promise<{ columns: string[]; rows: SqliteValue[][] }>
```

Key requirement for production-ready Drizzle proxy adapter.

## NATIVE-API-011 Native TTS Service

Status: proposed  
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

## NATIVE-API-012 Native Secure Storage

Status: proposed  
Priority: P1

```ts
native.secureStorage.get(key)
native.secureStorage.set(key, value)
native.secureStorage.remove(key)
native.secureStorage.list(prefix?)
```

Needed for secrets beyond v1 insecure SQLite fallback.

## NATIVE-API-013 Pinpad Service

Status: proposed  
Priority: P1/P0 for banking kiosk

Preferred via unified `native.device` model or typed service:

```ts
native.pinpad.getData(options)
native.pinpad.getPin(options)
native.pinpad.cancel(operationId?, reason?)
native.pinpad.onEvent(handler)
```

## NATIVE-API-014 Barcode Reader Service

Status: proposed  
Priority: P1

```ts
native.barcodeReader.startScan(options)
native.barcodeReader.stopScan(operationId?, reason?)
native.barcodeReader.onEvent(handler)
```

## NATIVE-API-015 Device Operation Cancellation

Status: proposed  
Priority: P0 for userInput nodes

Every long-running device operation must return or accept `operationId` and support cancel on node exit, timeout, interrupt, or flow cancellation.

## NATIVE-API-016 Device Lock / Exclusive Operation Support

Status: proposed  
Priority: P1

Native host should support or cooperate with framework device locks to avoid concurrent operations on pinpad, reader, cash unit, printer, etc.

## NATIVE-API-017 Unified Device API

Status: proposed  
Priority: P2

Preferred long-term model:

```ts
native.device.listDevices()
native.device.getStatus(deviceId)
native.device.execute({ deviceId, command, options, operationId })
native.device.cancel(operationId)
native.device.onEvent(handler)
```

Framework then exposes typed `PinpadPort`, `BarcodeReaderPort`, `CashUnitPort`, etc.
