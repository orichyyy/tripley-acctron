import {
  createBarcodeQrInputSourceAdapter,
  createPinpadDataInputSourceAdapter,
  createPinpadPinInputSourceAdapter,
} from "@tripley/web-container-device-core";

import { createStatusHealthCheck } from "./adapter-utils";
import { xfsCdmDeviceModuleAdapter } from "./cdm-adapter";
import { cimDeviceModuleAdapter } from "./cim-adapter";
import { XfsDeviceModuleAdapterRegistry, type XfsDeviceModuleAdapter } from "./module-adapters";
import {
  XfsBarcodeReaderDevicePort,
  XfsCardReaderDevicePort,
  XfsPinpadDevicePort,
} from "./ports";

const idcAdapter: XfsDeviceModuleAdapter = {
  module: "idc",
  requiredModule: "idc",
  create: async ({ client, config, session, timeoutMs }) => {
    const port = new XfsCardReaderDevicePort({
      client: client.idc,
      deviceId: config.deviceId,
      logicalName: config.logicalName,
      manager: client.manager,
      session,
      timeoutMs,
    });
    return {
      descriptor: descriptor(config, "cardReader"),
      healthCheck: createStatusHealthCheck({
        deviceId: config.deviceId,
        logicalName: config.logicalName,
        module: "idc",
        status: () => client.idc.getStatus({ sessionId: session.id, timeoutMs }),
      }),
      port,
    };
  },
};

const pinAdapter: XfsDeviceModuleAdapter = {
  module: "pin",
  requiredModule: "pin",
  create: async ({ client, config, session, timeoutMs }) => {
    const port = new XfsPinpadDevicePort({
      client: client.pin,
      deviceId: config.deviceId,
      logicalName: config.logicalName,
      manager: client.manager,
      session,
      timeoutMs,
    });
    return {
      descriptor: descriptor(config, "pinpad"),
      healthCheck: createStatusHealthCheck({
        deviceId: config.deviceId,
        logicalName: config.logicalName,
        module: "pin",
        status: () => client.pin.getStatus({ sessionId: session.id, timeoutMs }),
      }),
      inputSources: [
        createPinpadDataInputSourceAdapter(config.deviceId),
        createPinpadPinInputSourceAdapter(config.deviceId),
      ],
      port,
    };
  },
};

const bcrAdapter: XfsDeviceModuleAdapter = {
  module: "bcr",
  requiredModule: "bcr",
  create: async ({ client, config, session, timeoutMs }) => {
    const port = new XfsBarcodeReaderDevicePort({
      client: client.bcr,
      deviceId: config.deviceId,
      logicalName: config.logicalName,
      manager: client.manager,
      session,
      timeoutMs,
    });
    return {
      descriptor: descriptor(config, "barcodeReader"),
      healthCheck: createStatusHealthCheck({
        deviceId: config.deviceId,
        logicalName: config.logicalName,
        module: "bcr",
        status: () => client.bcr.getStatus({ sessionId: session.id, timeoutMs }),
      }),
      inputSources: [createBarcodeQrInputSourceAdapter(config.deviceId)],
      port,
    };
  },
};

export const createStandardXfsModuleAdapterRegistry = (): XfsDeviceModuleAdapterRegistry =>
  new XfsDeviceModuleAdapterRegistry()
    .register(idcAdapter)
    .register(pinAdapter)
    .register(bcrAdapter)
    .register(xfsCdmDeviceModuleAdapter)
    .register(cimDeviceModuleAdapter);

const descriptor = (
  config: Parameters<NonNullable<XfsDeviceModuleAdapter["validate"]>>[0],
  type: string,
) => ({
  capabilities: config.capabilities,
  dataClassification: config.dataClassification,
  id: config.deviceId,
  ownerPluginId: "xfs-device-service",
  type,
  vendor: "CEN/XFS",
});
