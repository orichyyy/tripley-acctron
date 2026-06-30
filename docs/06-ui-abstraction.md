# 06. UI Abstraction

## Purpose

Allow Flow nodes, commands, and plugins to navigate and update UI state without knowing the concrete UI framework, router, or state library.

## Decisions

- UI Adapter abstracts navigation, UI state, route registry, navigation menu contribution.
- `navigate(path, { replace?, state? })` only; no named route required.
- Flow can get/set/patch UI state.
- State scope: window + plugin + flow.
- Default state adapter: Zustand adapter.
- React Router adapter provided, core does not depend on React Router.
- Plugin routes registered at boot; dynamic registration reserved.
- Abstract route guard contract.
- Route contribution can declare layout key; plugin can register layout component.
- Each window creates an independent React root but shares framework runtime identity.
- Flow supports direct UI calls and UI effects; effect-first recommended.
- UI state is not persisted.

## UiPort

```ts
export interface UiPort {
  navigate(path: string, options?: NavigateOptions): Promise<void>;
  getState<T = unknown>(scope: UiStateScope, key: string): T | undefined;
  setState<T = unknown>(scope: UiStateScope, key: string, value: T): void;
  patchState<T extends object>(scope: UiStateScope, key: string, patch: Partial<T>): void;
}
```

## UI state scope

```ts
export interface UiStateScope {
  windowId?: string;
  windowKey?: string;
  pluginId?: string;
  flowInstanceId?: string;
}
```

UI state is for rendering and interaction state only. It is not persistent. Runtime business state belongs in ScopedStore or SQLite repositories.

## Route contribution

```ts
export interface RouteContribution {
  id: string;
  path: string;
  component: unknown;
  layout?: string;
  guards?: string[];
  ownerPluginId?: string;
}
```

## Navigation contribution

```ts
export interface NavigationContribution {
  id: string;
  label: string;
  path: string;
  commandId?: string;
  area?: 'customer' | 'admin' | 'developer' | string;
  order?: number;
  visibleWhen?: string | string[];
  enabledWhen?: string | string[];
  audit?: AuditContribution;
  tts?: TtsContribution;
}
```

## Guard contract

```ts
export interface RouteGuard {
  id: string;
  canActivate(ctx: RouteGuardContext): Promise<boolean | RouteGuardResult>;
}
```

Admin routes should use guards, but high-risk commands must also check policies in `canExecute` or business logic. UI visibility is not a security boundary.

## React adapter

`@tripley/web-container-react-adapter` implements:

- React root per native window.
- React Router adapter.
- Zustand state adapter.
- Route/layout/menu contribution rendering.
- `CommandButton` and `useCommand` helpers.
