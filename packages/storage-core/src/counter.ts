export interface CounterService {
  get(scope: string, name: string): Promise<number | null>;
  getOrCreate(scope: string, name: string, initialValue?: number): Promise<number>;
  increment(scope: string, name: string): Promise<number>;
  incrementBy(scope: string, name: string, delta: number): Promise<number>;
  reset(scope: string, name: string, value?: number): Promise<number>;
}

export const frameworkCounterTableSql = `CREATE TABLE IF NOT EXISTS framework_counter (
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  value INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT,
  PRIMARY KEY(scope, name)
);`;

export class InMemoryCounterService implements CounterService {
  private readonly counters = new Map<string, number>();
  private queue = Promise.resolve();

  public async get(scope: string, name: string): Promise<number | null> {
    return this.counters.get(counterKey(scope, name)) ?? null;
  }

  public async getOrCreate(scope: string, name: string, initialValue = 0): Promise<number> {
    return this.atomic(() => {
      const key = counterKey(scope, name);
      if (!this.counters.has(key)) {
        this.counters.set(key, initialValue);
      }

      return this.counters.get(key) ?? initialValue;
    });
  }

  public async increment(scope: string, name: string): Promise<number> {
    return this.incrementBy(scope, name, 1);
  }

  public async incrementBy(scope: string, name: string, delta: number): Promise<number> {
    return this.atomic(() => {
      const key = counterKey(scope, name);
      const next = (this.counters.get(key) ?? 0) + delta;
      this.counters.set(key, next);
      return next;
    });
  }

  public async reset(scope: string, name: string, value = 0): Promise<number> {
    return this.atomic(() => {
      this.counters.set(counterKey(scope, name), value);
      return value;
    });
  }

  private async atomic<T>(operation: () => T): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

const counterKey = (scope: string, name: string): string => `${scope}:${name}`;
