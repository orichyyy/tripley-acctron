import type { DatabaseSync as DatabaseSyncType, SQLInputValue } from "node:sqlite";

import type {
  FrameworkSqliteConnection,
  FrameworkSqliteTransaction,
  SqliteRunResult,
  SqliteValue,
} from "@tripley-kit/web-container-storage-core";

export class NodeSqliteConnection implements FrameworkSqliteConnection {
  readonly #database: DatabaseSyncType;

  public constructor(path: string) {
    this.#database = new DatabaseSync(path);
    this.#database.exec("PRAGMA foreign_keys = ON");
  }

  public async run(sql: string, params: readonly SqliteValue[] = []): Promise<SqliteRunResult> {
    const result = this.#database.prepare(sql).run(...normalize(params));
    return {
      changes: Number(result.changes),
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }

  public async queryOne<T>(sql: string, params: readonly SqliteValue[] = []): Promise<T | null> {
    return (this.#database.prepare(sql).get(...normalize(params)) as T | undefined) ?? null;
  }

  public async queryAll<T>(sql: string, params: readonly SqliteValue[] = []): Promise<T[]> {
    return this.#database.prepare(sql).all(...normalize(params)) as T[];
  }

  public async executeBatch(sql: string): Promise<void> {
    this.#database.exec(sql);
  }

  public async transaction<T>(fn: (tx: FrameworkSqliteTransaction) => Promise<T>): Promise<T> {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn(this);
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  public async close(): Promise<void> {
    this.#database.close();
  }
}

const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

const normalize = (values: readonly SqliteValue[]): SQLInputValue[] =>
  values.map((value) => typeof value === "boolean" ? Number(value) : value);
