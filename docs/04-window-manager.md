# 04. Window Manager

## Purpose

Manage native host windows for Web Container apps. Window Manager does not use `window.open` fallback in production. It relies on native window/display APIs.

## Decisions

- Native SDK window API is required.
- `windowKey` represents business window type; `windowId` represents instance.
- Same `windowKey` does not allow multiple instances.
- Opening an existing `windowKey` focuses the existing window.
- Open supports path + payload + features.
- Window features are strictly required; unsupported features fail fast.
- Lifecycle events: opened, ready, focused, blurred, hidden, shown, minimized, restored, closed, crashed, boundsChanged, displayChanged, alwaysOnTopChanged.
- Cross-window supports Event Bus broadcast and request-response.
- Multiple named root windows are needed.
- Restore is interface-reserved only.

## WindowPort

```ts
export interface WindowPort {
  open(options: OpenManagedWindowOptions): Promise<ManagedWindowRef>;
  close(selector: WindowSelector, reason?: string): Promise<void>;
  focus(selector: WindowSelector): Promise<void>;
  show(selector: WindowSelector): Promise<void>;
  hide(selector: WindowSelector): Promise<void>;
  minimize(selector: WindowSelector): Promise<void>;
  restore(selector: WindowSelector): Promise<void>;
  setAlwaysOnTop(selector: WindowSelector, alwaysOnTop: boolean): Promise<void>;
  setBounds(selector: WindowSelector, bounds: WindowBounds): Promise<void>;
  moveToDisplay(selector: WindowSelector, displayId: string, options?: MoveToDisplayOptions): Promise<void>;
  get(selector: WindowSelector): Promise<ManagedWindowInfo | null>;
  list(): Promise<ManagedWindowInfo[]>;
  broadcast<T = unknown>(message: WindowMessage<T>): Promise<void>;
  request<TRequest = unknown, TResponse = unknown>(target: WindowSelector, message: WindowMessage<TRequest>, options?: WindowRequestOptions): Promise<TResponse>;
}
```

## Window features

```ts
export interface ManagedWindowFeatures {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  fullscreen?: boolean;
  alwaysOnTop?: boolean;
  resizable?: boolean;
  frame?: boolean;
  visible?: boolean;
  transparent?: boolean;
  skipTaskbar?: boolean;
  focusOnOpen?: boolean;
  displayId?: string;
}
```

Unsupported required feature throws capability error.

## Display API

Display enumeration is required for kiosk placement.

```ts
export interface NativeDisplay {
  id: string;
  index: number;
  name?: string;
  isPrimary: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  workArea?: { x: number; y: number; width: number; height: number };
  scaleFactor?: number;
  rotation?: 0 | 90 | 180 | 270;
  touchSupport?: 'unknown' | 'available' | 'unavailable';
}
```

## Kiosk topology

Single-screen default:

```text
one kiosk.main native window
/customer/*
/admin/*
/advertising/*
```

Single-screen advanced:

```text
kiosk.customer + kiosk.admin overlay windows
explicit project config only
```

Multi-screen:

```text
root windows customer/admin/advertising supported
launch policy per project config: onBoot / onDemand / disabled
```

Display role mapping is loaded from project/device config and can be set by admin setup flow.

```ts
export interface DisplayRoleMapping {
  front?: string;
  rear?: string;
  top?: string;
}
```

## Legacy kiosk coexistence

Screen takeover is managed by Flow, not WindowFocusSession API.

A flow may call:

```ts
await ctx.window.restore({ windowKey: 'kiosk.customer' });
await ctx.window.show({ windowKey: 'kiosk.customer' });
await ctx.window.setAlwaysOnTop({ windowKey: 'kiosk.customer' }, true);
await ctx.window.focus({ windowKey: 'kiosk.customer' });
```

The release action is flow-specific: minimize, hide, close, or navigate idle.

## Required native APIs

Window/display/placement/z-order/visibility/lifecycle API requirements are tracked in `docs/14-native-sdk-api-requirements.md`.
