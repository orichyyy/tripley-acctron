import type {
  CimCashAcceptanceDevicePort,
  CimRefusedMediaRequest,
} from "@tripley-kit/web-container-xfs-device-service";

import type {
  DepositInventoryPort,
  DepositReturnedMediaPort,
} from "./contracts";

export const createXfsDepositInventoryAdapter = (
  device: CimCashAcceptanceDevicePort,
): DepositInventoryPort => ({
  capture: async (input) => {
    const captured = await device.captureInventory();
    return {
      boundary: input.boundary,
      capturedAt: captured.capturedAt,
      id: `${input.operationId}:${input.boundary}:${captured.revision}`,
      logicalService: input.logicalService,
      operationId: input.operationId,
      revision: captured.revision,
      safeSummary: {
        ...captured.safeSummary,
        boundary: input.boundary,
        resourceGroup: input.resourceGroup,
      },
    };
  },
});

export interface XfsDepositReturnedMediaAdapterOptions
  extends Omit<CimRefusedMediaRequest, "signal"> {}

export const createXfsDepositReturnedMediaAdapter = (
  device: CimCashAcceptanceDevicePort,
  options: XfsDepositReturnedMediaAdapterOptions,
): DepositReturnedMediaPort => ({
  resolveRefused: async (input) => {
    const result = await device.resolveRefusedMedia({ ...options, signal: input.signal });
    if (result.status === "cancelled") {
      return { reasonCode: "refused-media.cancelled", status: "unknown" };
    }
    return { status: result.status };
  },
});

