import type { FrameworkSqliteConnection } from "./sqlite";
import { describe, expect, it, vi } from "vitest";

import { SQLITE_MIGRATION_JOURNAL_SQL, SqliteMigrationStore } from "./sqlite-migration-store";

describe("SqliteMigrationStore", () => {
  it("bootstraps and maps durable migration rows", async () => {
    const executeBatch = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({ changes: 1 }));
    const db = {
      executeBatch,
      queryAll: vi.fn(async () => [{
        applied_at: "2026-07-21T00:00:00.000Z",
        id: "migration-1",
        package_id: "package-1",
      }]),
      run,
    } as unknown as FrameworkSqliteConnection;
    const store = new SqliteMigrationStore(db);

    await store.migrate();
    await store.markApplied({
      appliedAt: "2026-07-21T00:00:00.000Z",
      id: "migration-1",
      packageId: "package-1",
    });

    expect(executeBatch).toHaveBeenCalledWith(SQLITE_MIGRATION_JOURNAL_SQL);
    await expect(store.listApplied()).resolves.toEqual([{
      appliedAt: "2026-07-21T00:00:00.000Z",
      id: "migration-1",
      packageId: "package-1",
    }]);
    expect(run).toHaveBeenCalledWith(expect.stringContaining("framework_schema_migration"), [
      "migration-1",
      "package-1",
      "2026-07-21T00:00:00.000Z",
    ]);
  });
});

