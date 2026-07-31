import { XfsEventClassFromRaw } from "@tripley-kit/xfs-client";
import { FrameworkError } from "@tripley-kit/web-container-errors";

import { createStatusHealthCheck } from "./adapter-utils";
import { XfsCashDeliveryPort } from "./cash-delivery";
import { XfsCdmCashRecoveryDevice } from "./cash-recovery-device";
import type { XfsDeviceModuleAdapter } from "./module-adapters";
import { assertXfsOk } from "./utils";

export const xfsCdmDeviceModuleAdapter: XfsDeviceModuleAdapter = {
  module: "cdm",
  requiredModule: "cdm",
  validate: (config) => {
    if (!config.cdm) {
      throw configError("xfs.cdm.policy.missing", config.deviceId);
    }
  },
  create: async ({
    cash,
    cashRecoveryDevices,
    client,
    config,
    session,
    sessionGeneration,
    timeoutMs,
  }) => {
    const cdm = client.cdm;
    const commandLeases = client.commandLeases;
    if (!cdm || !commandLeases || !cash || !config.cdm) {
      throw configError("xfs.cdm.dependencies.missing", config.deviceId);
    }
    if (client.manager.registerEvents) {
      await client.manager.registerEvents({
        eventClass: XfsEventClassFromRaw(2),
        sessionId: session.id,
      });
    }
    const request = { sessionId: session.id, timeoutMs };
    const capabilities = await cdm.getCapabilities(request);
    assertXfsOk(capabilities, "cdm.getCapabilities", { deviceId: config.deviceId });
    if (config.cdm.delayedPresentation !== false &&
      (!capabilities.intermediateStacker || capabilities.retractAreas === 0)) {
      throw configError("xfs.cdm.delayedPresentation.unsupported", config.deviceId);
    }
    const port = new XfsCashDeliveryPort({
      client: cdm,
      commandLeases,
      dependencies: cash,
      deviceId: config.deviceId,
      logicalName: config.logicalName,
      policy: config.cdm,
      session,
      sessionGeneration,
      timeoutMs,
    });
    const recoveryDevice = new XfsCdmCashRecoveryDevice({
      client: cdm,
      configurationRevision: config.cdm.configurationRevision,
      idFactory: cash.idFactory,
      logicalService: config.logicalName,
      now: cash.now,
      outputPosition: config.cdm.outputPosition ?? 2,
      retractArea: config.cdm.retractArea ?? 1,
      retractIndex: config.cdm.retractIndex ?? 0,
      session,
      timeoutMs,
    });
    cashRecoveryDevices?.register(config.logicalName, recoveryDevice);
    return {
      descriptor: {
        capabilities: config.capabilities,
        dataClassification: config.dataClassification,
        id: config.deviceId,
        ownerPluginId: "xfs-device-service",
        type: "cashDispenser",
        vendor: "CEN/XFS",
      },
      healthCheck: createStatusHealthCheck({
        deviceId: config.deviceId,
        logicalName: config.logicalName,
        module: "cdm",
        status: () => cdm.getStatus(request),
      }),
      port,
      dispose: () => cashRecoveryDevices?.unregister(config.logicalName, recoveryDevice),
    };
  },
};

const configError = (code: string, deviceId: string): FrameworkError =>
  new FrameworkError({
    category: "configuration",
    code,
    message: `CDM configuration is invalid for device: ${deviceId}`,
    metadata: { deviceId },
  });
