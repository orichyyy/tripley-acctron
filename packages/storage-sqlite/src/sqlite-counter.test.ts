import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DefaultMigrationRunner,
  SqliteMigrationStore,
} from "@tripley-kit/web-container-storage-core";
import { afterEach, describe, expect, it } from "vitest";

import { NodeSqliteConnection } from "./node";
import {
  SqliteCounterService,
  storageSqliteStandardMigrations,
} from "./sqlite-counter";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

describe("SqliteCounterService", () => {
  it("allocates wrapped values atomically and survives reopening", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tripley-counter-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "runtime.db");
    const first = new NodeSqliteConnection(path);
    await migrate(first);
    const counters = new SqliteCounterService(first);

    await counters.reset("bsp", "transport", 998);
    await expect(
      Promise.all([
        counters.incrementWrapped("bsp", "transport", 999),
        counters.incrementWrapped("bsp", "transport", 999),
      ]),
    ).resolves.toEqual([999, 0]);
    await first.close();

    const reopened = new NodeSqliteConnection(path);
    await migrate(reopened);
    await expect(
      new SqliteCounterService(reopened).incrementWrapped(
        "bsp",
        "transport",
        999,
      ),
    ).resolves.toBe(1);
    await reopened.close();
  });
});

const migrate = async (db: NodeSqliteConnection): Promise<void> => {
  const store = new SqliteMigrationStore(db);
  await store.migrate();
  const runner = new DefaultMigrationRunner(store);
  storageSqliteStandardMigrations.forEach((migration) =>
    runner.register(migration),
  );
  await runner.runPending(db);
};
