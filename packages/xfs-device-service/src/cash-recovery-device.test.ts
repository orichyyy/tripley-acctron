import { describe, expect, it, vi } from "vitest";

import {
  CashRecoveryDeviceRegistry,
  XfsCdmCashRecoveryDevice,
} from "./cash-recovery-device";
import type { CashRecoveryLeaseRecord } from "./recovery-contracts";

describe("XFS CDM cash recovery device", () => {
  it("observes staged cash and retracts it under recovery ownership", async () => {
    const retract = vi.fn(async () => ({ native: { hResult: 0 } }));
    const device = new XfsCdmCashRecoveryDevice({
      client: {
        getCashUnitInfo: async () => ({
          cashUnits: [{
            cashUnitType: 3,
            count: 99,
            currencyId: "TWD",
            dispensedCount: 1,
            number: 1,
            physical: [],
            presentedCount: 0,
            rejectCount: 0,
            retractedCount: 1,
            status: 0,
            unitId: "cassette-1",
            values: 1_000,
          }],
          native: { hResult: 0 },
        }),
        getPresentStatus: async () => ({
          native: { hResult: 0 },
          position: 2,
          presentState: 2,
        }),
        getStatus: async () => ({
          fwIntermediateStacker: 1,
          native: { hResult: 0 },
          positions: [{ fwPosition: 2, fwPositionStatus: 0 }],
        }),
        retract,
      } as never,
      configurationRevision: "test.1",
      idFactory: () => "snapshot-1",
      logicalService: "CDM",
      now: () => new Date("2026-07-31T00:01:00.000Z"),
      outputPosition: 2,
      retractArea: 1,
      retractIndex: 1,
      session: { id: "cdm-session" },
      timeoutMs: 30_000,
    });

    await expect(device.observe(record())).resolves.toEqual({ state: "staged" });
    await expect(device.retract(record())).resolves.toEqual({ state: "retracted" });
    await expect(device.captureAfterSnapshot(record())).resolves.toMatchObject({
      boundary: "after",
      cashSessionId: "cash-1",
      id: "snapshot-1",
      operationId: "operation-1",
      units: [expect.objectContaining({ count: 99, retractedCount: 1 })],
    });
    expect(retract).toHaveBeenCalledWith({
      retract: { index: 1, outputPosition: 2, retractArea: 1 },
      sessionId: "cdm-session",
      timeoutMs: 30_000,
    });
  });

  it("registers one recovery adapter per logical service", () => {
    const registry = new CashRecoveryDeviceRegistry();
    const device = {
      captureAfterSnapshot: vi.fn(),
      observe: vi.fn(),
      retract: vi.fn(),
    };

    registry.register("CDM", device);

    expect(registry.require("CDM")).toBe(device);
    expect(() => registry.register("CDM", device)).toThrow(/already registered/i);
    registry.unregister("CDM", device);
    expect(() => registry.require("CDM")).toThrow(/not registered/i);
  });
});

const record = (): CashRecoveryLeaseRecord => ({
  authority: "recovery",
  cashSessionId: "cash-1",
  createdAt: "2026-07-31T00:00:00.000Z",
  evidenceSequence: 4,
  fencingToken: 2,
  hostEpoch: "epoch-1",
  id: "lease-1",
  logicalService: "CDM",
  module: "cdm",
  operationId: "operation-1",
  ownerInstanceId: "runtime-1",
  phase: "reconciling",
  recoveryDeadlineAt: "2026-07-31T00:02:00.000Z",
  revision: 3,
  state: "recoveryBound",
  updatedAt: "2026-07-31T00:00:01.000Z",
});
