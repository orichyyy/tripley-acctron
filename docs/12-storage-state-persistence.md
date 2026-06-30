# 12. Storage and State Persistence

## Purpose

Separate persistent storage, configuration, runtime scoped store, and UI state.

## State categories

| State | Purpose | Persistence |
| --- | --- | --- |
| UI state | rendering/loading/error in pages | not persisted |
| ScopedStore | runtime context by lifecycle | memory by default |
| Configuration | typed app/device/plugin settings | multi-provider, SQLite writable |
| SQLite repositories | transactions, messages, audit, counters | persisted |
| FlowStore | flow snapshots/traces | memory + optional SQLite |

## Storage core

```ts
export interface StorageRegistry {
  sqlite: SqliteConnectionRegistry;
  repositories: RepositoryRegistry;
  migrations: MigrationRunner;
  counters: CounterService;
}
```

## SQLite connection wrapper

The wrapper normalizes native SQLite APIs and enables future Drizzle adapter.

```ts
export interface FrameworkSqliteConnection {
  run(sql: string, params?: SqliteValue[]): Promise<SqliteRunResult>;
  queryOne<T>(sql: string, params?: SqliteValue[]): Promise<T | null>;
  queryAll<T>(sql: string, params?: SqliteValue[]): Promise<T[]>;
  executeBatch(sql: string): Promise<void>;
  transaction<T>(fn: (tx: FrameworkSqliteTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
```

Native SDK currently has `transaction(statements: string[])`; richer callback transactions and raw query results are tracked in SDK requirements.

## Migrations

```ts
export interface Migration {
  id: string;
  packageId: string;
  up(db: FrameworkSqliteConnection): Promise<void>;
  down?: (db: FrameworkSqliteConnection) => Promise<void>;
}
```

Migrations are registered by core, kiosk base, and project plugins.

## Repository extension

Project plugins can register repositories without core changes:

```ts
ctx.repositories.register('bank.customerProfile', new CustomerProfileRepository(db));
```
