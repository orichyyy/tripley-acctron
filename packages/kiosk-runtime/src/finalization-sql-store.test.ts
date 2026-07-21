import type { FrameworkSqliteConnection } from "@tripley-kit/web-container-storage-core";
import { describe, expect, it } from "vitest";

import type { OperationFinalizationRecord } from "./finalization-contracts";
import { SqliteOperationFinalizationStore } from "./finalization-sql-store";

describe("SqliteOperationFinalizationStore", () => {
  it("persists records across store instances and lists only incomplete work", async () => {
    const database = new MemoryFinalizationDatabase();
    const first = new SqliteOperationFinalizationStore(database.connection);
    await first.migrate();
    await first.save(record("operation-pending", "pending"));
    await first.save(record("operation-completed", "completed"));

    const restarted = new SqliteOperationFinalizationStore(database.connection);
    await expect(restarted.load("operation-pending")).resolves.toEqual(
      record("operation-pending", "pending"),
    );
    await expect(restarted.listIncomplete()).resolves.toEqual([
      record("operation-pending", "pending"),
    ]);
  });

  it("fails closed when durable JSON does not match its operation key", async () => {
    const database = new MemoryFinalizationDatabase();
    database.rows.set("operation-a", JSON.stringify(record("operation-b", "pending")));
    const store = new SqliteOperationFinalizationStore(database.connection);

    await expect(store.load("operation-a")).rejects.toThrow("Invalid operation finalization record");
  });
});

const record = (
  operationId: string,
  status: OperationFinalizationRecord["status"],
): OperationFinalizationRecord => ({
  operationId,
  planVersion: "1",
  status,
  steps: [],
  updatedAt: "2026-07-21T00:00:00.000Z",
});

class MemoryFinalizationDatabase {
  public readonly rows = new Map<string, string>();

  public readonly connection = {
    close: async () => undefined,
    executeBatch: async () => undefined,
    run: async (sql: string, parameters: readonly unknown[] = []) => {
      if (!sql.includes("INSERT INTO kiosk_operation_finalization")) return;
      this.rows.set(String(parameters[0]), String(parameters[3]));
      return { changes: 1 };
    },
    queryAll: async <T>(): Promise<T[]> =>
      [...this.rows.keys()].filter((key) => {
        const parsed = JSON.parse(this.rows.get(key) ?? "{}") as { status?: string };
        return parsed.status !== "completed";
      }).flatMap((operationId) => {
        const recordJson = this.rows.get(operationId);
        return recordJson ? [{ operation_id: operationId, record_json: recordJson } as T] : [];
      }),
    queryOne: async <T>(_sql: string, parameters: readonly unknown[] = []): Promise<T | null> => {
      const operationId = String(parameters[0]);
      const recordJson = this.rows.get(operationId);
      return recordJson ? { operation_id: operationId, record_json: recordJson } as T : null;
    },
    transaction: async <T>(work: (db: FrameworkSqliteConnection) => Promise<T>) =>
      work(this.connection as FrameworkSqliteConnection),
  } as unknown as FrameworkSqliteConnection;
}
