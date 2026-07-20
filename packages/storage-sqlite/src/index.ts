import type { FrameworkSqlitePort } from "@tripley-kit/web-container-native-adapter";
import type {
  FrameworkSqliteConnection,
  FrameworkSqliteTransaction,
  SqliteRunResult,
  SqliteValue,
} from "@tripley-kit/web-container-storage-core";

export const storageSqlitePackageName = "@tripley-kit/web-container-storage-sqlite";

export class NativePortSqliteConnection implements FrameworkSqliteConnection {
  public constructor(private readonly sqlite: FrameworkSqlitePort) {}

  public async run(sql: string, params: readonly SqliteValue[] = []): Promise<SqliteRunResult> {
    return this.sqlite.call<SqliteRunResult>("run", sql, params);
  }

  public async queryOne<T>(sql: string, params: readonly SqliteValue[] = []): Promise<T | null> {
    return this.sqlite.call<T | null>("queryOne", sql, params);
  }

  public async queryAll<T>(sql: string, params: readonly SqliteValue[] = []): Promise<T[]> {
    return this.sqlite.call<T[]>("queryAll", sql, params);
  }

  public async executeBatch(sql: string): Promise<void> {
    await this.sqlite.call("executeBatch", sql);
  }

  public async transaction<T>(fn: (tx: FrameworkSqliteTransaction) => Promise<T>): Promise<T> {
    return fn(this);
  }

  public async close(): Promise<void> {
    await this.sqlite.call("close");
  }
}
