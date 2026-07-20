import { FrameworkError } from "@tripley-kit/web-container-errors";

import { createStatusHealthCheck } from "./adapter-utils";
import { XfsCashDeliveryPort } from "./cash-delivery";
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
  create: async ({ cash, client, config, session, sessionGeneration, timeoutMs }) => {
    const cdm = client.cdm;
    const commandLeases = client.commandLeases;
    if (!cdm || !commandLeases || !cash || !config.cdm) {
      throw configError("xfs.cdm.dependencies.missing", config.deviceId);
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
