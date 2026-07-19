import { describe, expect, it, vi } from "vitest";
import { CashAcceptanceService } from "./cash-acceptance";
import type { CashAcceptanceEvidencePort, CimCashInClient } from "./cash-acceptance-contracts";
import { normalizeCashAcceptancePolicy } from "./cash-acceptance-policy";
import { InMemoryCashAcceptanceStore } from "./cash-acceptance-store";

function fixture() {
  const cashInEnd = vi.fn(async () => undefined);
  const cashInRollback = vi.fn(async () => undefined);
  const retract = vi.fn(async () => undefined);
  const client: CimCashInClient = {
    cashInStart: vi.fn(async () => undefined),
    cashIn: vi.fn(async () => ({ status: "active", notes: [{ noteId: 2, count: 3 }] })),
    getCashInStatus: vi.fn(async () => ({ status: "active" })),
    cashInEnd,
    cashInRollback,
    waitForCashTaken: vi.fn(async () => false),
    retract,
  };
  const events: Parameters<CashAcceptanceEvidencePort["append"]>[0][] = [];
  const release = vi.fn(async () => undefined);
  const service = new CashAcceptanceService({
    client,
    entryGate: { assertCanStart: vi.fn(async () => undefined) },
    evidence: { append: async (event) => { events.push(event); } },
    leases: { acquire: vi.fn(async () => ({ fencingToken: 17, release })) },
    store: new InMemoryCashAcceptanceStore(),
    now: () => new Date("2026-07-19T00:00:00.000Z"),
  });
  return { service, client, cashInEnd, cashInRollback, retract, release, events };
}

const request = {
  operationId: "deposit-1",
  logicalService: "CIM30",
  resourceGroup: "cash-transport-1",
  policy: normalizeCashAcceptancePolicy({ notTakenAction: "retract" }),
};

describe("CashAcceptanceService", () => {
  it("accepts multiple batches and commits only an exact authorized escrow revision", async () => {
    const target = fixture();
    const session = await target.service.start(request);
    await session.acceptBatch();
    const snapshot = await session.acceptBatch();
    const authorization = await session.authorize({
      authorize: async () => ({
        operationId: request.operationId,
        revision: snapshot.revision,
        snapshotHash: snapshot.hash,
        approved: true,
      }),
    });

    const result = await session.commit(authorization);

    expect(target.cashInEnd).toHaveBeenCalledOnce();
    expect(target.release).toHaveBeenCalledOnce();
    expect(result.committed).toBe(true);
    expect(result.safeSummary).toMatchObject({ snapshotRevision: 2, noteCount: 6 });
    expect(target.events.find((event) => event.event === "physical-commit-dispatched")?.safeDetails)
      .toEqual({ revision: 2, snapshotHash: snapshot.hash });
  });

  it("rejects stale business authorization without dispatching physical commit", async () => {
    const target = fixture();
    const session = await target.service.start(request);
    const snapshot = await session.acceptBatch();

    await expect(session.commit({
      operationId: request.operationId,
      revision: snapshot.revision - 1,
      snapshotHash: snapshot.hash,
      approved: true,
    })).rejects.toMatchObject({ reason: "authorization-stale" });
    expect(target.cashInEnd).not.toHaveBeenCalled();
  });

  it("treats abort as a return request and records the final retracted custody", async () => {
    const target = fixture();
    const session = await target.service.start(request);
    await session.acceptBatch();

    const result = await session.abort("timeout");

    expect(target.cashInRollback).toHaveBeenCalledOnce();
    expect(target.retract).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ reason: "retracted", committed: false });
    expect(result.portions[0]?.custody).toBe("retract-unit");
  });

  it("does not retract when returned escrow is taken by the customer", async () => {
    const target = fixture();
    vi.mocked(target.client.waitForCashTaken).mockResolvedValue(true);
    const session = await target.service.start(request);
    await session.acceptBatch();

    const result = await session.abort("cancelled");

    expect(target.retract).not.toHaveBeenCalled();
    expect(target.release).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ reason: "returned", committed: false });
    expect(result.portions[0]?.custody).toBe("customer");
  });
});
