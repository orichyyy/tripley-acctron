import type { XfsStartupRequest } from "@tripley-kit/xfs-client";
import {
  type CorrelatedInputCompletionBroker,
  type DeviceRegistry,
  type InputSourceRegistry,
  withInputCompletionBroker,
} from "@tripley-kit/web-container-device-core";
import { FrameworkError } from "@tripley-kit/web-container-errors";

import { createTripleyKitXfsRuntimeClient } from "./client-factory";
import type {
  XfsDeviceModuleAdapter,
  XfsDeviceModuleContribution,
} from "./module-adapters";
import { HostCommandLeaseExecutor } from "./command-lease-executor";
import { createStandardXfsModuleAdapterRegistry } from "./standard-adapters";
import type {
  XfsDeviceServiceConfig,
  XfsDeviceServiceOptions,
  XfsHealthCheck,
  XfsLogicalServiceConfig,
  XfsRequiredModule,
  XfsRuntimeClientLike,
  XfsSessionLike,
} from "./types";
import {
  assertXfsOk,
  defaultXfsAppId,
  defaultXfsTimeoutMs,
  defaultXfsVersionRange,
} from "./utils";

interface ResolvedService {
  readonly adapter: XfsDeviceModuleAdapter;
  readonly config: XfsLogicalServiceConfig;
}

export class XfsDeviceService {
  private readonly client: XfsRuntimeClientLike;
  private readonly commandLeases: HostCommandLeaseExecutor;
  private readonly resolved: readonly ResolvedService[];
  private readonly sessions = new Map<string, XfsSessionLike>();
  private readonly contributions = new Map<string, XfsDeviceModuleContribution>();
  private connected = false;
  private sessionGeneration = 0;

  public constructor(
    private readonly config: XfsDeviceServiceConfig,
    private readonly options: XfsDeviceServiceOptions = {},
  ) {
    validateConfig(config);
    const registry = options.moduleAdapters ?? createStandardXfsModuleAdapterRegistry();
    this.resolved = config.logicalServices.map((service) => {
      const adapter = registry.require(service.module);
      adapter.validate?.(service);
      return { adapter, config: service };
    });
    registry.freeze();
    this.client = options.client ??
      (options.clientFactory ?? createTripleyKitXfsRuntimeClient)({
        authToken: config.authToken,
        requiredModules: this.requiredModules(),
        url: config.url,
      });
    this.commandLeases = new HostCommandLeaseExecutor(
      () => this.client.commandLeases,
      config.ownerInstanceId ??
        `${config.appId ?? defaultXfsAppId}:${crypto.randomUUID()}`,
    );
  }

  public requiredModules(): readonly XfsRequiredModule[] {
    return ["manager", ...new Set(this.resolved.map(({ adapter }) => adapter.requiredModule))];
  }

  public async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.connect();
    await this.startup();
    this.sessionGeneration += 1;
    for (const resolved of this.resolved) {
      const session = await this.open(resolved.config);
      this.sessions.set(resolved.config.deviceId, session);
      const contribution = await resolved.adapter.create({
        cash: this.options.cash,
        cashRecoveryDevices: this.options.cashRecoveryDevices,
        client: this.client,
        commandLeases: this.commandLeases,
        config: resolved.config,
        session,
        sessionGeneration: this.sessionGeneration,
        timeoutMs: this.timeoutMs(),
      });
      this.contributions.set(resolved.config.deviceId, contribution);
    }
    this.connected = true;
  }

  public registerDevices(registry: DeviceRegistry): void {
    for (const [deviceId, contribution] of this.contributions) {
      registry.register(deviceId, { descriptor: contribution.descriptor, port: contribution.port });
    }
  }

  public registerInputSources(
    registry: InputSourceRegistry,
    completionBroker?: CorrelatedInputCompletionBroker,
  ): void {
    for (const contribution of this.contributions.values()) {
      for (const adapter of contribution.inputSources ?? []) {
        registry.register(
          completionBroker ? withInputCompletionBroker(adapter, completionBroker) : adapter,
        );
      }
    }
  }

  public healthChecks(): readonly XfsHealthCheck[] {
    return [...this.contributions.values()].map(({ healthCheck }) => healthCheck);
  }

  public async dispose(): Promise<void> {
    try {
      for (const contribution of [...this.contributions.values()].reverse()) {
        await contribution.dispose?.();
      }
      this.contributions.clear();
      for (const [deviceId, session] of this.sessions) {
        await this.close(deviceId, session);
      }
      this.sessions.clear();
      this.connected = false;
    } finally {
      await this.client.dispose();
    }
  }

  private async startup(): Promise<void> {
    const startup = this.config.startup;
    if (startup?.enabled === false) return;
    const request: XfsStartupRequest = {
      versionsRequired: {
        high: startup?.highVersion ?? defaultXfsVersionRange.high,
        low: startup?.lowVersion ?? defaultXfsVersionRange.low,
      },
    };
    if (startup?.dllDirectory) request.dllDirectory = startup.dllDirectory;
    assertXfsOk(await this.client.manager.startup(request), "manager.startup");
  }

  private async open(service: XfsLogicalServiceConfig): Promise<XfsSessionLike> {
    const result = await this.client.manager.open({
      appId: this.config.appId ?? defaultXfsAppId,
      logicalName: service.logicalName,
      serviceVersionsRequired: {
        high: this.config.startup?.highVersion ?? defaultXfsVersionRange.high,
        low: this.config.startup?.lowVersion ?? defaultXfsVersionRange.low,
      },
      timeoutMs: this.timeoutMs(),
      traceLevel: 0,
    });
    assertXfsOk(result.native, "manager.open", {
      deviceId: service.deviceId,
      logicalName: service.logicalName,
    });
    return result.session;
  }

  private async close(deviceId: string, session: XfsSessionLike): Promise<void> {
    await this.client.manager.close({ sessionId: session.id }).catch((error: unknown) => {
      throw new FrameworkError({
        category: "native",
        cause: error,
        code: "xfs.session.closeFailed",
        message: `Failed to close XFS session for device: ${deviceId}`,
        metadata: { deviceId, sessionId: session.id },
      });
    });
  }

  private timeoutMs(): number {
    return this.config.timeoutMs ?? defaultXfsTimeoutMs;
  }
}

export const createXfsDeviceService = (
  config: XfsDeviceServiceConfig,
  options?: XfsDeviceServiceOptions,
): XfsDeviceService => new XfsDeviceService(config, options);

const validateConfig = (config: XfsDeviceServiceConfig): void => {
  if (config.logicalServices.length === 0) {
    throw configError("xfs.logicalServices.empty", "At least one XFS logical service is required.");
  }
  const ids = new Set<string>();
  for (const service of config.logicalServices) {
    if (ids.has(service.deviceId)) {
      throw configError("xfs.device.duplicate", `Duplicate XFS device id: ${service.deviceId}`);
    }
    ids.add(service.deviceId);
  }
};

const configError = (code: string, message: string): FrameworkError =>
  new FrameworkError({ category: "configuration", code, message });
