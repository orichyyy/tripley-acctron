import { describe, expect, it, vi } from "vitest";
import { CashAcceptanceRecoverySupervisor } from "./cash-acceptance-recovery";
import { InMemoryCashAcceptanceStore } from "./cash-acceptance-store";
import type { CashAcceptanceRecord, CimCashInClient } from "./cash-acceptance-contracts";

async function inspect(physicalCommitDispatched: boolean) {
  const store = new InMemoryCashAcceptanceStore();
  const record: CashAcceptanceRecord = {
    operationId: "deposit-recovery", logicalService: "CIM30", phase: "escrowed", revision: 1,
    physicalCommitDispatched, updatedAt: "2026-07-19T00:00:00.000Z",
  };
  await store.create(record);
  const cashInEnd = vi.fn(async () => undefined);
  const client: CimCashInClient = {
    cashInStart: vi.fn(), cashIn: vi.fn(), getCashInStatus: vi.fn(async () => ({ status: "escrow" })),
    cashInEnd, cashInRollback: vi.fn(async () => undefined), waitForCashTaken: vi.fn(async () => false),
    retract: vi.fn(async () => undefined),
  };
  const observations = await new CashAcceptanceRecoverySupervisor(store, client).inspect();
  return { observations, cashInEnd };
}

describe("CashAcceptanceRecoverySupervisor", () => {
  it("may roll back undispatched escrow but never initiates physical commit", async () => {
    const result = await inspect(false);
    expect(result.observations[0]?.decision.action).toBe("rollback");
    expect(result.cashInEnd).not.toHaveBeenCalled();
  });

  it("only observes an operation after physical commit was dispatched", async () => {
    const result = await inspect(true);
    expect(result.observations[0]?.decision.action).toBe("observe");
    expect(result.cashInEnd).not.toHaveBeenCalled();
  });
});
