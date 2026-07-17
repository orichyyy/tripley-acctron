import type { XfsHealthCheck, XfsHealthCheckResult, XfsNativeEnvelopeLike } from "./types";
import { hResultOf } from "./utils";

export const createStatusHealthCheck = (options: {
  readonly deviceId: string;
  readonly logicalName: string;
  readonly module: string;
  readonly status: () => Promise<XfsNativeEnvelopeLike>;
}): XfsHealthCheck => ({
  id: `xfs.${options.deviceId}.health`,
  check: async () => {
    try {
      const result = await options.status();
      const hResult = hResultOf(result);
      const fwDevice = result.fwDevice;
      return {
        id: `xfs.${options.deviceId}.health`,
        ...(fwDevice !== undefined && fwDevice !== xfsDeviceOnline
          ? { message: `XFS device reported state ${fwDevice}.` }
          : {}),
        metadata: {
          deviceId: options.deviceId,
          ...(fwDevice !== undefined ? { fwDevice } : {}),
          hResult,
          logicalName: options.logicalName,
          module: options.module,
        },
        status: classifyServiceHealth(hResult, fwDevice),
      };
    } catch (error) {
      return {
        id: `xfs.${options.deviceId}.health`,
        message: error instanceof Error ? error.message : String(error),
        metadata: {
          deviceId: options.deviceId,
          logicalName: options.logicalName,
          module: options.module,
        },
        status: "unhealthy",
      };
    }
  },
});

const xfsDeviceOnline = 0;
const xfsDeviceBusy = 6;

const classifyServiceHealth = (
  hResult: number,
  fwDevice: number | undefined,
): XfsHealthCheckResult["status"] => {
  if (hResult !== 0) return "degraded";
  if (fwDevice === undefined || fwDevice === xfsDeviceOnline) return "healthy";
  return fwDevice === xfsDeviceBusy ? "degraded" : "unhealthy";
};
