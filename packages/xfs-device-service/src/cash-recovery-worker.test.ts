import { describe, expect, it, vi } from "vitest";

import { CashRecoveryWorker } from "./cash-recovery-worker";

describe("CashRecoveryWorker", () => {
  it("runs recovery after accepting a foreground transfer", async () => {
    const recover = vi.fn(async () => result("ready"));
    const worker = new CashRecoveryWorker({
      acceptTransfer: async () => ({
        fencingToken: 2,
        leaseId: "lease-1",
        state: "recoveryBound",
      }),
      recover,
    });

    await expect(worker.acceptTransfer({} as never)).resolves.toMatchObject({
      leaseId: "lease-1",
    });
    await expect(worker.dispose()).resolves.toBeUndefined();
    expect(recover).toHaveBeenCalledOnce();
  });

  it("blocks shutdown while transferred cash remains unresolved", async () => {
    const worker = new CashRecoveryWorker({
      acceptTransfer: async () => ({
        fencingToken: 2,
        leaseId: "lease-1",
        state: "transferPending",
      }),
      recover: async () => result("recovering"),
    });

    await worker.acceptTransfer({} as never);

    await expect(worker.dispose()).rejects.toThrow(/unresolved cash recovery/i);
  });
});

const result = (status: "ready" | "recovering") => ({
  deadlineBreaches: 0,
  recovered: status === "ready" ? 1 : 0,
  safeSummary: {
    deadlineBreaches: 0,
    recovered: status === "ready" ? 1 : 0,
    unresolved: status === "ready" ? 0 : 1,
  },
  status,
  unresolved: status === "ready" ? 0 : 1,
} as const);
