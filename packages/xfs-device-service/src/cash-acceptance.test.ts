import { describe, expect, it, vi } from "vitest";
import { CashAcceptanceService } from "./cash-acceptance";
import type { CashAcceptanceEvidencePort, CimCashInClient } from "./cash-acceptance-contracts";
import { normalizeCashAcceptancePolicy } from "./cash-acceptance-policy";
import { InMemoryCashAcceptanceStore } from "./cash-acceptance-store";

function fixture() {
  const cashInRollback = vi.fn(async () => undefined);
  const retract = vi.fn(async () => undefined);
  const client: CimCashInClient = {
    getCapabilities: vi.fn(async () => ({
      maxCashInItems: 200,
      positions: 1,
      retractAreas: 1,
      shutterControl: "service-provider" as const,
    })),
    captureCashUnits: vi.fn()
      .mockResolvedValueOnce([{ logicalUnit: 1, physicalPosition: "RECYCLER1", physicalUnitId: "A1", currency: "TWD", denominationMinorUnits: 1_000, count: 10, cashInCount: 0, rejectCount: 0, retractedCount: 0, status: 0 }])
      .mockResolvedValue([{ logicalUnit: 1, physicalPosition: "RECYCLER1", physicalUnitId: "A1", currency: "TWD", denominationMinorUnits: 1_000, count: 16, cashInCount: 6, rejectCount: 0, retractedCount: 0, status: 0 }]),
    cashInStart: vi.fn(async () => undefined),
    openShutter: vi.fn(async () => undefined),
    closeShutter: vi.fn(async () => undefined),
    cashIn: vi.fn(async () => ({ status: "active", notes: [{ noteId: 2, count: 3 }] })),
    getCashInStatus: vi.fn(async () => ({ status: "active" })),
    cashInEnd: vi.fn(async () => [{ logicalUnit: 1, physicalPosition: "RECYCLER1", physicalUnitId: "A1", currency: "TWD", denominationMinorUnits: 1_000, count: 16, cashInCount: 6, rejectCount: 0, retractedCount: 0, status: 0 }]),
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
  return { service, client, cashInEnd: client.cashInEnd, cashInRollback, retract, release, events };
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
    expect(result.destinationEvidence).toMatchObject([
      { logicalUnit: 1, physicalPosition: "RECYCLER1", depositedCount: 6 },
    ]);
    expect(result.safeSummary).toMatchObject({ snapshotRevision: 2, noteCount: 6 });
    expect(target.events.find((event) => event.event === "physical-commit-dispatched")?.safeDetails)
      .toEqual({ revision: 2, snapshotHash: snapshot.hash });
  });

  it("uses explicit shutter commands only when required by CIM capabilities", async () => {
    const target = fixture();
    vi.mocked(target.client.getCapabilities).mockResolvedValue({
      maxCashInItems: 200,
      positions: 1,
      retractAreas: 1,
      shutterControl: "application",
    });
    const session = await target.service.start(request);
    await session.acceptBatch();

    expect(target.client.openShutter).toHaveBeenCalledOnce();
    expect(target.client.closeShutter).toHaveBeenCalledOnce();
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

  it("keeps the cash-in session active when the customer takes refused notes", async () => {
    const target = fixture();
    vi.mocked(target.client.cashIn).mockResolvedValue({
      status: "active",
      notes: [{ noteId: 2, count: 3 }],
      refusedCount: 1,
    });
    vi.mocked(target.client.waitForCashTaken).mockResolvedValue(true);
    const session = await target.service.start(request);
    await session.acceptBatch();

    const resolution = await session.resolveRefusedMedia();

    expect(resolution).toEqual({ refusedCount: 1, status: "taken" });
    expect(session.phase).toBe("escrowed");
    expect(target.retract).not.toHaveBeenCalled();
    expect(target.release).not.toHaveBeenCalled();
  });

  it("uses the current refused-media signal instead of retaining a previous node signal", async () => {
    const target = fixture();
    const previousNode = new AbortController();
    const refusedMediaNode = new AbortController();
    vi.mocked(target.client.cashIn).mockResolvedValue({
      status: "active",
      notes: [{ noteId: 2, count: 1 }],
      refusedCount: 1,
    });
    vi.mocked(target.client.waitForCashTaken).mockImplementation(async (request) => {
      expect(request.signal).toBe(refusedMediaNode.signal);
      return true;
    });
    const session = await target.service.start({ ...request, signal: previousNode.signal });
    await session.acceptBatch();
    previousNode.abort();

    const resolution = await session.resolveRefusedMedia({ signal: refusedMediaNode.signal });

    expect(resolution.status).toBe("taken");
    expect(session.phase).toBe("escrowed");
  });

  it("retracts untaken refused notes and terminates the cash-in session", async () => {
    const target = fixture();
    vi.mocked(target.client.cashIn).mockResolvedValue({
      status: "active",
      notes: [{ noteId: 2, count: 3 }],
      refusedCount: 2,
    });
    const session = await target.service.start(request);
    await session.acceptBatch();

    const resolution = await session.resolveRefusedMedia();

    expect(resolution.status).toBe("retracted");
    expect(session.phase).toBe("failed");
    expect(target.cashInRollback).not.toHaveBeenCalled();
    expect(target.retract).toHaveBeenCalledOnce();
    expect(target.release).toHaveBeenCalledOnce();
    expect(resolution.terminalResult).toMatchObject({
      reason: "refused-media-retracted",
      safeSummary: { acceptedNoteCount: 3, refusedCount: 2 },
      portions: [
        { portionId: "accepted-escrow", custody: "unknown" },
        { portionId: "refused-media", custody: "retract-unit", reason: "refused-count:2" },
      ],
    });
  });
});
