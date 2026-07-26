import type {
  DeviceDescriptor,
  InputSourceAdapter,
} from "@tripley-kit/web-container-device-core";
import { FrameworkError } from "@tripley-kit/web-container-errors";

import type { CashDeliveryDependencies } from "./cash-contracts";
import type { XfsCommandLeaseExecutor } from "./command-lease-executor";
import type {
  XfsHealthCheck,
  XfsLogicalServiceConfig,
  XfsRequiredModule,
  XfsRuntimeClientLike,
  XfsSessionLike,
} from "./types";

export interface XfsDeviceModuleContribution {
  readonly descriptor: DeviceDescriptor;
  readonly port: unknown;
  readonly healthCheck: XfsHealthCheck;
  readonly inputSources?: readonly InputSourceAdapter[] | undefined;
  dispose?(): void | Promise<void>;
}

export interface XfsDeviceModuleAdapterContext {
  readonly cash?: CashDeliveryDependencies | undefined;
  readonly client: XfsRuntimeClientLike;
  readonly commandLeases: XfsCommandLeaseExecutor;
  readonly config: XfsLogicalServiceConfig;
  readonly session: XfsSessionLike;
  readonly sessionGeneration: number;
  readonly timeoutMs: number;
}

export interface XfsDeviceModuleAdapter {
  readonly module: string;
  readonly requiredModule: XfsRequiredModule;
  validate?(config: XfsLogicalServiceConfig): void;
  create(context: XfsDeviceModuleAdapterContext): Promise<XfsDeviceModuleContribution>;
}

export class XfsDeviceModuleAdapterRegistry {
  private readonly adapters = new Map<string, XfsDeviceModuleAdapter>();
  private frozen = false;

  public register(adapter: XfsDeviceModuleAdapter): this {
    if (this.frozen) {
      throw configurationError("xfs.moduleAdapters.frozen", "XFS module adapters are frozen.");
    }
    if (this.adapters.has(adapter.module)) {
      throw configurationError(
        "xfs.moduleAdapter.duplicate",
        `Duplicate XFS module adapter: ${adapter.module}`,
        { module: adapter.module },
      );
    }
    this.adapters.set(adapter.module, adapter);
    return this;
  }

  public require(moduleName: string): XfsDeviceModuleAdapter {
    const adapter = this.adapters.get(moduleName);
    if (!adapter) {
      throw configurationError(
        "xfs.moduleAdapter.missing",
        `No XFS module adapter is registered for: ${moduleName}`,
        { module: moduleName },
      );
    }
    return adapter;
  }

  public freeze(): this {
    this.frozen = true;
    return this;
  }

  public list(): readonly XfsDeviceModuleAdapter[] {
    return [...this.adapters.values()];
  }
}

const configurationError = (
  code: string,
  message: string,
  metadata?: Readonly<Record<string, string>>,
): FrameworkError =>
  new FrameworkError({ category: "configuration", code, message, metadata });
