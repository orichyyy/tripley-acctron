import type {
  CimCashAcceptanceDevicePort,
  CimRefusedMediaResult,
} from "@tripley-kit/web-container-xfs-device-service";
import { describe, expect, it, vi } from "vitest";

import {
  createXfsDepositInventoryAdapter,
  createXfsDepositReturnedMediaAdapter,
} from "./xfs-adapters";

describe("deposit XFS adapters", () => {
  it("maps safe CIM inventory into a transaction boundary snapshot", async () => {
    const device = fakeDevice({ status: "taken", safeSummary: {} });
    const adapter = createXfsDepositInventoryAdapter(device);

    await expect(adapter.capture({
      boundary: "before",
      logicalService: "CashAcceptor1",
      operationId: "deposit-1",
      resourceGroup: "cash-acceptance-1",
    })).resolves.toEqual({
      boundary: "before",
      capturedAt: "2026-07-21T00:00:00.000Z",
      id: "deposit-1:before:cim-1234",
      logicalService: "CashAcceptor1",
      operationId: "deposit-1",
      revision: "cim-1234",
      safeSummary: {
        boundary: "before",
        cashUnitCount: 2,
        noteCount: 40,
        resourceGroup: "cash-acceptance-1",
      },
    });
  });

  it("passes cancellation to refused-media handling and returns a safe reason", async () => {
    const device = fakeDevice({ status: "cancelled", safeSummary: { status: "cancelled" } });
    const adapter = createXfsDepositReturnedMediaAdapter(device, {
      outputPosition: 2,
      retractTimeoutMs: 5_000,
      takeTimeoutMs: 10_000,
    });
    const controller = new AbortController();
    controller.abort("customer-cancelled");

    await expect(adapter.resolveRefused({
      logicalService: "CashAcceptor1",
      operationId: "deposit-1",
      refusedCount: 1,
      signal: controller.signal,
    })).resolves.toEqual({
      reasonCode: "refused-media.cancelled",
      status: "unknown",
    });
    expect(device.resolveRefusedMedia).toHaveBeenCalledWith(expect.objectContaining({
      signal: controller.signal,
    }));
  });
});

const fakeDevice = (result: CimRefusedMediaResult): CimCashAcceptanceDevicePort => ({
  captureInventory: vi.fn(async () => ({
    capturedAt: "2026-07-21T00:00:00.000Z",
    revision: "cim-1234",
    safeSummary: { cashUnitCount: 2, noteCount: 40 },
  })),
  createService: vi.fn(() => {
    throw new Error("not used");
  }),
  resolveRefusedMedia: vi.fn(async () => result),
});

