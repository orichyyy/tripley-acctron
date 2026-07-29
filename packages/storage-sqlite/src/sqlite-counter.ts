import type {
  CounterService,
  FrameworkSqliteConnection,
  FrameworkSqliteTransaction,
  Migration,
} from "@tripley-kit/web-container-storage-core";
import { frameworkCounterTableSql } from "@tripley-kit/web-container-storage-core";

const packageId = "@tripley-kit/web-container-storage-sqlite";

export const storageSqliteStandardMigrations: readonly Migration[] = [
  {
    id: "storage-sqlite.001.counter",
    packageId,
    up: async (db) => {
      await db.executeBatch(frameworkCounterTableSql);
    },
  },
];

export class SqliteCounterService implements CounterService {
  private queue = Promise.resolve();

  public constructor(private readonly db: FrameworkSqliteConnection) {}

  public async get(scope: string, name: string): Promise<number | null> {
    const row = await this.db.queryOne<{ readonly value: number }>(
      "SELECT value FROM framework_counter WHERE scope = ? AND name = ?",
      [scope, name],
    );
    return row?.value ?? null;
  }

  public getOrCreate(
    scope: string,
    name: string,
    initialValue = 0,
  ): Promise<number> {
    assertInteger(initialValue, "initialValue");
    return this.atomic(async (tx) => {
      await insertIfMissing(tx, scope, name, initialValue);
      return requireCounter(tx, scope, name);
    });
  }

  public increment(scope: string, name: string): Promise<number> {
    return this.incrementBy(scope, name, 1);
  }

  public incrementBy(
    scope: string,
    name: string,
    delta: number,
  ): Promise<number> {
    assertInteger(delta, "delta");
    return this.atomic(async (tx) => {
      const now = new Date().toISOString();
      await tx.run(
        `INSERT INTO framework_counter
         (scope, name, value, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(scope, name) DO UPDATE SET
           value = framework_counter.value + excluded.value,
           updated_at = excluded.updated_at`,
        [scope, name, delta, now, now],
      );
      return requireCounter(tx, scope, name);
    });
  }

  public incrementWrapped(
    scope: string,
    name: string,
    maximum: number,
  ): Promise<number> {
    assertInteger(maximum, "maximum");
    if (maximum < 0) {
      throw new Error("maximum must not be negative.");
    }
    return this.atomic(async (tx) => {
      const now = new Date().toISOString();
      await tx.run(
        `INSERT INTO framework_counter
         (scope, name, value, created_at, updated_at)
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(scope, name) DO UPDATE SET
           value = CASE
             WHEN framework_counter.value >= ? THEN 0
             ELSE framework_counter.value + 1
           END,
           updated_at = excluded.updated_at`,
        [scope, name, now, now, maximum],
      );
      return requireCounter(tx, scope, name);
    });
  }

  public reset(scope: string, name: string, value = 0): Promise<number> {
    assertInteger(value, "value");
    return this.atomic(async (tx) => {
      const now = new Date().toISOString();
      await tx.run(
        `INSERT INTO framework_counter
         (scope, name, value, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(scope, name) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
        [scope, name, value, now, now],
      );
      return value;
    });
  }

  private async atomic<T>(
    operation: (tx: FrameworkSqliteTransaction) => Promise<T>,
  ): Promise<T> {
    const next = this.queue.then(
      () => this.db.transaction(operation),
      () => this.db.transaction(operation),
    );
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

const insertIfMissing = async (
  tx: FrameworkSqliteTransaction,
  scope: string,
  name: string,
  value: number,
): Promise<void> => {
  const now = new Date().toISOString();
  await tx.run(
    `INSERT INTO framework_counter
     (scope, name, value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(scope, name) DO NOTHING`,
    [scope, name, value, now, now],
  );
};

const requireCounter = async (
  tx: FrameworkSqliteTransaction,
  scope: string,
  name: string,
): Promise<number> => {
  const row = await tx.queryOne<{ readonly value: number }>(
    "SELECT value FROM framework_counter WHERE scope = ? AND name = ?",
    [scope, name],
  );
  if (!row) {
    throw new Error(`SQLite counter is missing: ${scope}/${name}`);
  }
  return row.value;
};

const assertInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a safe integer.`);
  }
};
