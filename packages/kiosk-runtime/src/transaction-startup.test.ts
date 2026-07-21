import type { FrameworkSqliteConnection } from "@tripley-kit/web-container-storage-core";
import { describe, expect, it, vi } from "vitest";

import { InMemoryOperationFinalizationStore } from "./finalization-store";
import { TransactionStartupCoordinator } from "./transaction-startup";

describe("TransactionStartupCoordinator", () => {
  it("runs migrations, protection recovery, and finalization recovery in order", async () => {
    const order: string[] = [];
    const coordinator = new TransactionStartupCoordinator({
      db: {} as FrameworkSqliteConnection,
      finalizationRecovery: { resume: async () => { order.push("finalization"); return { status: "ready" }; } },
      finalizations: new InMemoryOperationFinalizationStore(),
      migrations: { runPending: async () => { order.push("migrations"); return [{ appliedAt: "now", id: "m1", packageId: "p1" }]; } },
      protection: { recover: async () => { order.push("protection"); return { safeSummary: {}, status: "ready" }; } },
    });

    expect(coordinator.canExecute()).toBe(false);
    await expect(coordinator.initialize()).resolves.toMatchObject({
      appliedMigrationIds: ["m1"],
      status: "ready",
    });
    expect(order).toEqual(["migrations", "protection", "finalization"]);
    expect(coordinator.canExecute()).toBe(true);
  });

  it("blocks finalization and execution when protection needs intervention", async () => {
    const resume = vi.fn(async () => ({ status: "ready" as const }));
    const coordinator = new TransactionStartupCoordinator({
      db: {} as FrameworkSqliteConnection,
      finalizationRecovery: { resume },
      finalizations: new InMemoryOperationFinalizationStore(),
      migrations: { runPending: async () => [] },
      protection: { recover: async () => ({ safeSummary: {}, status: "intervention" }) },
    });

    await expect(coordinator.initialize()).resolves.toMatchObject({ status: "intervention" });
    expect(resume).not.toHaveBeenCalled();
    expect(() => coordinator.assertReady()).toThrow("not ready");
  });
});

