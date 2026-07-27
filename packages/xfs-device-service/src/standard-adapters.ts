import {
  XfsEventClass,
  XfsEventClassFromRaw,
} from "@tripley-kit/xfs-client";
import {
  createBarcodeQrInputSourceAdapter,
  createPinpadDataInputSourceAdapter,
  createPinpadPinInputSourceAdapter,
} from "@tripley-kit/web-container-device-core";

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
  create: async ({ client, commandLeases, config, session, timeoutMs }) => {
    if (client.manager.registerEvents) {
      await commandLeases.run({
        authority: "transaction",
        logicalService: config.logicalName,
        operationId: `${config.deviceId}.register-events`,
        protectionPolicyProfileId: config.protectionPolicyProfileId,
        resourceGroup: config.resourceGroup,
        ttlMs: timeoutMs,
      }, () => client.manager.registerEvents!({
          eventClass: XfsEventClassFromRaw(
            XfsEventClass.Service | XfsEventClass.User | XfsEventClass.Execute,
          ),
          sessionId: session.id,
        }));
    }
    const port = new XfsCardReaderDevicePort({
      client: client.idc,
      deviceId: config.deviceId,
      logicalName: config.logicalName,
      manager: client.manager,
      commandLeases,
      protectionPolicyProfileId: config.protectionPolicyProfileId,
      resourceGroup: config.resourceGroup,
      resetBeforeRead: config.idc?.resetBeforeRead,
      session,
      timeoutMs,
    });
    return {
      descriptor: descriptor(config, "cardReader"),
      healthCheck: createStatusHealthCheck({
        deviceId: config.deviceId,
        logicalName: config.logicalName,
        module: "idc",
        status: () => commandLeases.run({
          authority: "observation",
          logicalService: config.logicalName,
          operationId: `${config.deviceId}.health`,
          protectionPolicyProfileId: config.protectionPolicyProfileId,
          resourceGroup: config.resourceGroup,
          ttlMs: timeoutMs,
        }, () => client.idc.getStatus({ sessionId: session.id, timeoutMs })),
      }),
      port,
    };
  },
};

const pinAdapter: XfsDeviceModuleAdapter = {
  module: "pin",
  requiredModule: "pin",
  create: async ({ client, commandLeases, config, session, timeoutMs }) => {
    if (client.manager.registerEvents) {
      await commandLeases.run({
        authority: "transaction",
        logicalService: config.logicalName,
        operationId: `${config.deviceId}.register-events`,
        protectionPolicyProfileId: config.protectionPolicyProfileId,
        resourceGroup: config.resourceGroup,
        ttlMs: timeoutMs,
      }, () => client.manager.registerEvents!({
        eventClass: XfsEventClassFromRaw(XfsEventClass.Execute),
        sessionId: session.id,
      }));
    }
    const port = new XfsPinpadDevicePort({
      client: client.pin,
      deviceId: config.deviceId,
      logicalName: config.logicalName,
      manager: client.manager,
      commandLeases,
      protectionPolicyProfileId: config.protectionPolicyProfileId,
      resourceGroup: config.resourceGroup,
      session,
      timeoutMs,
    });
    return {
      descriptor: descriptor(config, "pinpad"),
      dispose: () => port.dispose(),
      healthCheck: createStatusHealthCheck({
        deviceId: config.deviceId,
        logicalName: config.logicalName,
        module: "pin",
        status: () => commandLeases.run({
          authority: "observation",
          logicalService: config.logicalName,
          operationId: `${config.deviceId}.health`,
          protectionPolicyProfileId: config.protectionPolicyProfileId,
          resourceGroup: config.resourceGroup,
          ttlMs: timeoutMs,
        }, () => client.pin.getStatus({ sessionId: session.id, timeoutMs })),
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
  create: async ({ client, commandLeases, config, session, timeoutMs }) => {
    const port = new XfsBarcodeReaderDevicePort({
      client: client.bcr,
      deviceId: config.deviceId,
      logicalName: config.logicalName,
      manager: client.manager,
      commandLeases,
      protectionPolicyProfileId: config.protectionPolicyProfileId,
      resourceGroup: config.resourceGroup,
      session,
      timeoutMs,
    });
    return {
      descriptor: descriptor(config, "barcodeReader"),
      healthCheck: createStatusHealthCheck({
        deviceId: config.deviceId,
        logicalName: config.logicalName,
        module: "bcr",
        status: () => commandLeases.run({
          authority: "observation",
          logicalService: config.logicalName,
          operationId: `${config.deviceId}.health`,
          protectionPolicyProfileId: config.protectionPolicyProfileId,
          resourceGroup: config.resourceGroup,
          ttlMs: timeoutMs,
        }, () => client.bcr.getStatus({ sessionId: session.id, timeoutMs })),
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
