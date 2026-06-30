export type SqlitePrimitive = string | number | boolean | null;
export type SqliteValue = SqlitePrimitive | Uint8Array;

export interface SqliteRunResult {
  readonly changes?: number;
  readonly lastInsertRowid?: string | number;
}

export interface FrameworkSqliteConnection {
  run(sql: string, params?: readonly SqliteValue[]): Promise<SqliteRunResult>;
  queryOne<T>(sql: string, params?: readonly SqliteValue[]): Promise<T | null>;
  queryAll<T>(sql: string, params?: readonly SqliteValue[]): Promise<T[]>;
  executeBatch(sql: string): Promise<void>;
  transaction<T>(fn: (tx: FrameworkSqliteTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export type FrameworkSqliteTransaction = Omit<FrameworkSqliteConnection, "close" | "transaction">;

export interface SqliteConnectionRegistry {
  register(name: string, connection: FrameworkSqliteConnection): void;
  get(name: string): FrameworkSqliteConnection | undefined;
  require(name: string): FrameworkSqliteConnection;
  list(): readonly string[];
}

export class DefaultSqliteConnectionRegistry implements SqliteConnectionRegistry {
  private readonly connections = new Map<string, FrameworkSqliteConnection>();

  public register(name: string, connection: FrameworkSqliteConnection): void {
    if (this.connections.has(name)) {
      throw new Error(`SQLite connection already registered: ${name}`);
    }

    this.connections.set(name, connection);
  }

  public get(name: string): FrameworkSqliteConnection | undefined {
    return this.connections.get(name);
  }

  public require(name: string): FrameworkSqliteConnection {
    const connection = this.get(name);
    if (!connection) {
      throw new Error(`SQLite connection is not registered: ${name}`);
    }

    return connection;
  }

  public list(): readonly string[] {
    return [...this.connections.keys()];
  }
}
