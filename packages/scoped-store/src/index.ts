import { FrameworkError } from "@tripley-kit/web-container-errors";

export const scopedStorePackageName = "@tripley-kit/web-container-scoped-store";

export type StoreScope = "application" | "session" | "transaction" | "flow" | "node";

export interface ScopedStore {
  scope(scope: StoreScope, id?: string): ScopedStoreView;
  clearScope(
    scope: Exclude<StoreScope, "application">,
    id?: string,
    reason?: string,
  ): Promise<void>;
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

export interface ScopedStoreClearRecord {
  readonly scope: Exclude<StoreScope, "application">;
  readonly id?: string | undefined;
  readonly reason?: string | undefined;
  readonly clearedAt: string;
}

export class MemoryScopedStore implements ScopedStore {
  private readonly stores = new Map<string, Map<string, unknown>>();
  private readonly clearHistory: ScopedStoreClearRecord[] = [];

  public scope(scope: StoreScope, id = "default"): ScopedStoreView {
    const key = scopeKey(scope, id);
    const values = this.stores.get(key) ?? new Map<string, unknown>();
    this.stores.set(key, values);
    return new MemoryScopedStoreView(values);
  }

  public async clearScope(
    scope: Exclude<StoreScope, "application">,
    id = "default",
    reason?: string,
  ): Promise<void> {
    this.stores.delete(scopeKey(scope, id));
    this.clearHistory.push({
      clearedAt: new Date().toISOString(),
      id,
      reason,
      scope,
    });
  }

  public async resetTransaction(reason = "transaction.reset"): Promise<void> {
    await this.clearScope("transaction", "default", reason);
    await this.clearAllMatching("transaction", reason);
    await this.clearAllMatching("flow", reason);
    await this.clearAllMatching("node", reason);
  }

  public async resetSession(reason = "session.reset"): Promise<void> {
    await this.clearScope("session", "default", reason);
    await this.resetTransaction(reason);
  }

  public listClearHistory(): readonly ScopedStoreClearRecord[] {
    return [...this.clearHistory];
  }

  private async clearAllMatching(
    scope: Exclude<StoreScope, "application">,
    reason: string,
  ): Promise<void> {
    for (const key of [...this.stores.keys()]) {
      if (key.startsWith(`${scope}:`)) {
        const id = key.slice(scope.length + 1);
        await this.clearScope(scope, id, reason);
      }
    }
  }
}

class MemoryScopedStoreView implements ScopedStoreView {
  public constructor(private readonly values: Map<string, unknown>) {}

  public get<T = unknown>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  public getOrThrow<T = unknown>(key: string): T {
    const value = this.get<T>(key);
    if (value === undefined) {
      throw new FrameworkError({
        category: "configuration",
        code: "scopedStore.key.missing",
        message: `Scoped store key is missing: ${key}`,
        metadata: { key },
      });
    }

    return value;
  }

  public getOrCreate<T>(key: string, factory: () => T): T {
    const existing = this.get<T>(key);
    if (existing !== undefined) {
      return existing;
    }

    const value = factory();
    this.set(key, value);
    return value;
  }

  public set<T>(key: string, value: T): void {
    this.values.set(key, value);
  }

  public patch<T extends object>(key: string, patch: Partial<T>): void {
    const existing = this.get<T>(key);
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      throw new FrameworkError({
        category: "configuration",
        code: "scopedStore.patch.notObject",
        message: `Cannot patch non-object scoped store value: ${key}`,
        metadata: { key },
      });
    }

    this.values.set(key, { ...existing, ...patch });
  }

  public remove(key: string): void {
    this.values.delete(key);
  }

  public keys(): string[] {
    return [...this.values.keys()].sort();
  }
}

const scopeKey = (scope: StoreScope, id: string): string => `${scope}:${id}`;
