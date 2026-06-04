import type { TransactionDataStore } from "@tripley-acctron/contracts";

export class InMemoryTransactionDataStore implements TransactionDataStore {
  private readonly values = new Map<string, unknown>();

  public get<T = unknown>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  public set<T = unknown>(key: string, value: T): void {
    this.values.set(key, value);
  }

  public has(key: string): boolean {
    return this.values.has(key);
  }

  public delete(key: string): boolean {
    return this.values.delete(key);
  }

  public clear(): void {
    this.values.clear();
  }

  public snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.values.entries());
  }
}
