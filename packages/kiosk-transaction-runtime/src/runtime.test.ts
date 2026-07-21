import type {
  FrameworkSqliteConnection,
  FrameworkSqliteTransaction,
} from "@tripley-kit/web-container-storage-core";
import { describe, expect, it, vi } from "vitest";

import { createDurableKioskTransactionRuntime } from "./runtime";

describe("durable kiosk transaction runtime", () => {
  it("boots durable services through the ordered readiness gate", async () => {
    const order: string[] = [];
    const runtime = createDurableKioskTransactionRuntime({
      db: fakeDatabase(order),
      finalizationRecovery: {
        resume: async () => {
          order.push("finalization");
          return { status: "ready" };
        },
      },
      protection: {
        recover: async () => {
          order.push("protection");
          return { safeSummary: {}, status: "ready" };
        },
      },
    });

    expect(runtime.startup.canExecute()).toBe(false);
    await expect(runtime.startup.initialize()).resolves.toMatchObject({ status: "ready" });
    expect(runtime.startup.canExecute()).toBe(true);
    expect(order.at(-2)).toBe("protection");
    expect(order.at(-1)).toBe("finalization");
    expect(runtime.transactions).toBeDefined();
    expect(runtime.ledger).toBeDefined();
    expect(runtime.outbox).toBeDefined();
  });
});

const fakeDatabase = (order: string[]): FrameworkSqliteConnection => {
  const db = {
    close: async () => undefined,
    executeBatch: async (sql: string) => {
      order.push(sql.includes("framework_schema_migration") ? "migration-journal" : "migration");
    },
    queryAll: async () => [],
    queryOne: async () => null,
    run: vi.fn(async () => ({ changes: 1 })),
    transaction: async <T>(work: (tx: FrameworkSqliteTransaction) => Promise<T>) => work(db),
  } as FrameworkSqliteConnection;
  return db;
};

