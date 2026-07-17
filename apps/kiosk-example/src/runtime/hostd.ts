import type { DeviceRegistry, InputSourceRegistry } from "@tripley/web-container-device-core";
import { FrameworkError } from "@tripley/web-container-errors";
import type { CapabilityStatus } from "@tripley/web-container-kiosk-runtime";
import {
  type XfsDeviceService,
  createXfsDeviceService,
} from "@tripley/web-container-xfs-device-service";

export interface HostdRuntimeConfig {
  readonly url: string;
  readonly authToken?: string | undefined;
  readonly idcLogicalName: string;
  readonly pinLogicalName: string;
  readonly pinCustomerData: string;
  readonly pinKeyName: string;
  readonly bcrLogicalName?: string | undefined;
}

export interface HostdDeviceComposition {
  readonly service: XfsDeviceService;
  readonly capabilities: Readonly<Record<string, CapabilityStatus>>;
  readonly health: HostdHealthSnapshot;
  checkCapabilities(): Promise<HostdHealthSnapshot>;
  dispose(): Promise<void>;
}

export interface HostdHealthSnapshot {
  readonly capabilities: Readonly<Record<string, CapabilityStatus>>;
  readonly checkedAt: string;
  readonly checks: readonly {
    readonly id: string;
    readonly status: "healthy" | "degraded" | "unhealthy";
  }[];
}

export const connectHostdDevices = async (
  config: HostdRuntimeConfig,
  devices: DeviceRegistry,
  inputSources: InputSourceRegistry,
): Promise<HostdDeviceComposition> => {
  if (!config.idcLogicalName || !config.pinLogicalName) {
    throw new FrameworkError({
      category: "configuration",
      code: "kiosk.hostd.logicalServices.required",
      message: "Hostd mode requires configured IDC and PIN logical service names.",
    });
  }
  const service = createXfsDeviceService({
    ...(config.authToken ? { authToken: config.authToken } : {}),
    logicalServices: [
      {
        capabilities: ["card.read", "card.eject", "card.retain", "card.mediaStatus"],
        deviceId: "cardReader",
        logicalName: config.idcLogicalName,
        module: "idc",
      },
      {
        capabilities: ["pin.getPin"],
        dataClassification: "secret",
        deviceId: "pinpad",
        logicalName: config.pinLogicalName,
        module: "pin",
      },
      ...(config.bcrLogicalName
        ? [
            {
              capabilities: ["barcode.qr"],
              dataClassification: "sensitive" as const,
              deviceId: "barcodeReader",
              logicalName: config.bcrLogicalName,
              module: "bcr" as const,
            },
          ]
        : []),
    ],
    url: config.url,
  });
  await service.connect();
  service.registerDevices(devices);
  service.registerInputSources(inputSources);
  const checkCapabilities = async (): Promise<HostdHealthSnapshot> => {
    const checks = await Promise.all(service.healthChecks().map((check) => check.check()));
    const statusByDevice = new Map(
      checks.map((check) => [
        check.id.replace(/^xfs\./, "").replace(/\.health$/, ""),
        check.status,
      ]),
    );
    const capabilityStatus = (deviceId: string): CapabilityStatus => {
      const status = statusByDevice.get(deviceId);
      return status === "healthy"
        ? "available"
        : status === "degraded"
          ? "degraded"
          : "unavailable";
    };
    return {
      capabilities: {
        "device.idc": capabilityStatus("cardReader"),
        "device.pin": capabilityStatus("pinpad"),
        ...(config.bcrLogicalName ? { "device.bcr": capabilityStatus("barcodeReader") } : {}),
      },
      checkedAt: new Date().toISOString(),
      checks: checks.map(({ id, status }) => ({ id, status })),
    };
  };
  const initialHealth = await checkCapabilities();
  return {
    capabilities: initialHealth.capabilities,
    checkCapabilities,
    dispose: () => service.dispose(),
    health: initialHealth,
    service,
  };
};
