# 21. Scoped Store

## Purpose

Provide runtime state with explicit lifecycle reset semantics. This is not UI state, not configuration, and not persistent business repository.

## Scopes

```ts
export type StoreScope = 'application' | 'session' | 'transaction' | 'flow' | 'node';
```

Lifecycle:

```text
application: app lifetime, never auto-cleared.
session: customer session, cleared when card/no-card session ends and Attraction page is reached.
transaction: single transaction, cleared after returning MainMenu.
flow: flow instance, cleared on flow completed/failed/cancelled/timedOut.
node: node execution, cleared after node exits.
```

## API

```ts
export interface ScopedStore {
  scope(scope: StoreScope, id?: string): ScopedStoreView;
  clearScope(scope: Exclude<StoreScope, 'application'>, id?: string, reason?: string): Promise<void>;
  resetTransaction(reason?: string): Promise<void>;
  resetSession(reason?: string): Promise<void>;
}

export interface ScopedStoreView {
  get<T = unknown>(key: string): T | undefined;
  getOrThrow<T = unknown>(key: string): T;
  getOrCreate<T>(key: string, factory: () => T): T;
  set<T>(key: string, value: T): void;
  patch<T extends object>(key: string, patch: Partial<T>): void;
  remove(key: string): void;
  keys(): string[];
}
```

## Flow hooks

```ts
flowEngine.registerHook({
  onFlowFinally: async ctx => scopedStore.clearScope('flow', ctx.instanceId, 'flow.finally'),
  afterNodeRun: async ctx => scopedStore.clearScope('node', ctx.nodeExecutionId, 'node.exit')
});
```

## Best practices

- Do not store persistent transaction records in ScopedStore; use TransactionRepository.
- Do not store raw PIN/password/secret.
- Store customer language, accessibility mode, selected account type, transactionId, temporary input summaries.
- application scope is not affected by clearAll.
