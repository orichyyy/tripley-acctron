import { describe, expect, it } from "vitest";

import { InMemoryCashRecoveryLeaseStore, cashRecoveryLeaseTableSql } from "./recovery-store";

describe("CashRecoveryLeaseStore", () => {
  it("allows only one unresolved lease per logical service", async () => {
    const store = new InMemoryCashRecoveryLeaseStore();
    await store.create(input("lease-1", "cash-1"));

    await expect(store.create(input("lease-2", "cash-2"))).rejects.toThrow(/unresolved/i);
    expect(cashRecoveryLeaseTableSql).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*logical_service\)[\s\S]*WHERE state <> 'closed'/,
    );
  });

  it("rejects stale revision and stale owner compare-and-swap", async () => {
    const store = new InMemoryCashRecoveryLeaseStore();
    const record = await store.create(input("lease-1", "cash-1"));

    await expect(store.compareAndSwap({
      expectedOwnerInstanceId: "runtime-stale", expectedRevision: record.revision,
      id: record.id, patch: { state: "transferPending" }, updatedAt: new Date(1).toISOString(),
    })).resolves.toBeNull();
    await expect(store.compareAndSwap({
      expectedOwnerInstanceId: record.ownerInstanceId, expectedRevision: record.revision + 1,
      id: record.id, patch: { state: "transferPending" }, updatedAt: new Date(1).toISOString(),
    })).resolves.toBeNull();
  });
});

const input = (id: string, cashSessionId: string) => ({
  cashSessionId,
  createdAt: new Date(0).toISOString(),
  fencingToken: 1,
  id,
  logicalService: "CDM1",
  module: "cdm" as const,
  operationId: `operation-${id}`,
  ownerInstanceId: "runtime-1",
  recoveryDeadlineAt: new Date(60_000).toISOString(),
});
