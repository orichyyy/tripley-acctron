import { describe, expect, it } from "vitest";

import {
  DurableCashRecoveryLeaseAdapter,
  InMemoryCashRecoveryLeaseStore,
  cashRecoveryLeaseTableSql,
} from "./recovery-store";

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

  it("allocates time-based tokens monotonically across adapter restarts", async () => {
    const store = new InMemoryCashRecoveryLeaseStore();
    const now = new Date("2026-07-29T12:00:00.000Z");
    const firstAdapter = adapter(store, now);
    const first = await firstAdapter.acquire(leaseInput("lease-1", "cash-1"));
    await firstAdapter.close(first, "notDispensed");

    const secondAdapter = adapter(store, now);
    const second = await secondAdapter.acquire(leaseInput("lease-2", "cash-2"));

    expect(first.fencingToken).toBe(now.getTime() * 1_000);
    expect(second.fencingToken).toBe(first.fencingToken + 1);
  });

  it("starts a rebuilt store from the current time floor", async () => {
    const rebuilt = new InMemoryCashRecoveryLeaseStore();
    const now = new Date("2026-07-29T12:00:01.000Z");

    const lease = await adapter(rebuilt, now).acquire(
      leaseInput("lease-rebuilt", "cash-rebuilt"),
    );

    expect(lease.fencingToken).toBe(now.getTime() * 1_000);
  });
});

const adapter = (
  store: InMemoryCashRecoveryLeaseStore,
  now: Date,
) => new DurableCashRecoveryLeaseAdapter(store, {
  deadlineMs: 60_000,
  idFactory: () => crypto.randomUUID(),
  now: () => now,
});

const leaseInput = (id: string, cashSessionId: string) => ({
  cashSessionId,
  logicalService: "CDM1",
  operationId: `operation-${id}`,
  ownerInstanceId: "runtime-1",
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
