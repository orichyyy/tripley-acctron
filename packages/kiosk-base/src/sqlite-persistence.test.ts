import type {
  FrameworkSqliteConnection,
  FrameworkSqliteTransaction,
} from "@tripley-kit/web-container-storage-core";
import { describe, expect, it, vi } from "vitest";

import { SqliteAuditJournalRepository } from "./repositories/sqlite-audit";
import {
  SqliteTransactionMessageRepository,
  SqliteTransactionRepository,
} from "./repositories/sqlite-transactions";

describe("kiosk SQLite persistence", () => {
  it("creates a transaction and allocates its message sequence atomically", async () => {
    const run = vi.fn(async () => ({ changes: 1 }));
    const transaction = vi.fn(async <T>(work: (tx: FrameworkSqliteTransaction) => Promise<T>) =>
      work({
        executeBatch: async () => undefined,
        queryAll: async () => [],
        queryOne: async <T>(sql: string) => (
          sql.includes("MAX(seq)") ? { next_seq: 3 } as T : { id: "transaction-1" } as T
        ),
        run,
      }),
    );
    const db = { run, transaction } as unknown as FrameworkSqliteConnection;
    const clock = { now: () => new Date("2026-07-21T00:00:00.000Z") };
    const messages = new SqliteTransactionMessageRepository(db, clock);
    const repository = new SqliteTransactionRepository(db, clock, messages);

    await expect(repository.create({
      businessType: "cash.deposit",
      currency: "CNY",
      id: "transaction-1",
      metadata: { entryMethod: "cash" },
    })).resolves.toMatchObject({
      id: "transaction-1",
      startedAt: "2026-07-21T00:00:00.000Z",
      status: "started",
    });
    await expect(repository.appendMessage("transaction-1", {
      direction: "outbound",
      id: "message-1",
      messageType: "0200",
      payload: { safeReference: "request-1" },
    })).resolves.toMatchObject({
      createdAt: "2026-07-21T00:00:00.000Z",
      seq: 3,
      transactionId: "transaction-1",
    });
    expect(transaction).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(expect.stringContaining("kiosk_transaction_message"),
      expect.arrayContaining(["message-1", "transaction-1", 3]));
  });

  it("maps durable EJ rows without exposing absent optional fields", async () => {
    const db = {
      queryAll: vi.fn(async () => [{
        business_type: "cash.deposit",
        created_at: "2026-07-21T00:00:00.000Z",
        data_json: '{"cashUnitCount":2}',
        event_id: "cash.inventory.before",
        event_name: null,
        flow_instance_id: null,
        id: "ej-1",
        message: "Inventory captured.",
        session_id: null,
        trace_id: null,
        transaction_id: "transaction-1",
      }]),
    } as unknown as FrameworkSqliteConnection;

    await expect(
      new SqliteAuditJournalRepository(db).listByTransaction("transaction-1"),
    ).resolves.toEqual([{
      businessType: "cash.deposit",
      createdAt: "2026-07-21T00:00:00.000Z",
      data: { cashUnitCount: 2 },
      eventId: "cash.inventory.before",
      id: "ej-1",
      message: "Inventory captured.",
      transactionId: "transaction-1",
    }]);
  });
});

