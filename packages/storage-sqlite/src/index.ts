import type { FrameworkSqlitePort } from "@tripley-kit/web-container-native-adapter";
import type {
  FrameworkSqliteConnection,
  FrameworkSqliteTransaction,
  SqliteRunResult,
  SqliteValue,
} from "@tripley-kit/web-container-storage-core";

export const storageSqlitePackageName = "@tripley-kit/web-container-storage-sqlite";

export * from "./sqlite-counter";

export interface NativeSqliteApiLike {
  open(path: string): Promise<unknown>;
}

export class NativePortSqliteConnection implements FrameworkSqliteConnection {
  private transactionQueue = Promise.resolve();

  public constructor(
    private readonly sqlite: FrameworkSqlitePort | NativeSqliteDatabaseLike,
  ) {}

  public static async open(
    sqlite: NativeSqliteApiLike,
    path: string,
  ): Promise<NativePortSqliteConnection> {
    return new NativePortSqliteConnection(
      assertNativeDatabase(await sqlite.open(path)),
    );
  }

  public async run(sql: string, params: readonly SqliteValue[] = []): Promise<SqliteRunResult> {
    return this.call<SqliteRunResult>("run", sql, params);
  }

  public async queryOne<T>(sql: string, params: readonly SqliteValue[] = []): Promise<T | null> {
    return this.call<T | null>("queryOne", sql, params);
  }

  public async queryAll<T>(sql: string, params: readonly SqliteValue[] = []): Promise<T[]> {
    return this.call<T[]>("queryAll", sql, params);
  }

  public async executeBatch(sql: string): Promise<void> {
    await this.call("executeBatch", sql);
  }

  public async transaction<T>(fn: (tx: FrameworkSqliteTransaction) => Promise<T>): Promise<T> {
    return this.atomic(async () => {
      await this.executeBatch("BEGIN IMMEDIATE");
      try {
        const result = await fn(this);
        await this.executeBatch("COMMIT");
        return result;
      } catch (error) {
        await this.executeBatch("ROLLBACK").catch(() => undefined);
        throw error;
      }
    });
  }

  public async close(): Promise<void> {
    await this.call("close");
  }

  private call<TResponse = unknown>(
    method: string,
    ...args: readonly unknown[]
  ): Promise<TResponse> {
    if (isFrameworkSqlitePort(this.sqlite)) {
      return this.sqlite.call<TResponse>(method, ...args);
    }
    const candidate = this.sqlite[method];
    if (typeof candidate !== "function") {
      throw new Error(`Native SQLite database method is missing: ${method}`);
    }
    return candidate.apply(this.sqlite, args) as Promise<TResponse>;
  }

  private async atomic<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.transactionQueue.then(operation, operation);
    this.transactionQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

type NativeSqliteDatabaseLike = Record<string, unknown>;

const isFrameworkSqlitePort = (
  value: FrameworkSqlitePort | NativeSqliteDatabaseLike,
): value is FrameworkSqlitePort => typeof value.call === "function";

const assertNativeDatabase = (value: unknown): NativeSqliteDatabaseLike => {
  if (!value || typeof value !== "object") {
    throw new Error("Native SQLite open did not return a database.");
  }
  const database = value as NativeSqliteDatabaseLike;
  for (const method of ["run", "queryOne", "queryAll", "executeBatch", "close"]) {
    if (typeof database[method] !== "function") {
      throw new Error(`Native SQLite database method is missing: ${method}`);
    }
  }
  return database;
};
