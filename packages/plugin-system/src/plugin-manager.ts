import { FrameworkError } from "@tripley-kit/web-container-errors";
import type { EventBus } from "@tripley-kit/web-container-event-bus";
import type { LoggerPort } from "@tripley-kit/web-container-logging";
import { ServiceRegistry } from "@tripley-kit/web-container-registry";
import type { Disposable } from "@tripley-kit/web-container-utils";
import { type FrameworkExtensionRegistry, createFrameworkExtensionRegistry } from "./contributions";
import type { PluginManifest, PluginPermissions } from "./manifest";

export type PluginEventMap = Record<string, unknown>;

export interface PluginRuntimeContext {
  readonly appId: string;
  readonly projectId: string;
  readonly pluginId: string;
  readonly eventBus?: EventBus<PluginEventMap> | undefined;
  readonly logger?: LoggerPort | undefined;
  readonly services: ServiceRegistry;
  readonly extensions: FrameworkExtensionRegistry;
  readonly [port: string]: unknown;
}

export type PluginInstallContext = PluginRuntimeContext;
export type PluginRegisterContext = PluginRuntimeContext;
export type PluginActivateContext = PluginRuntimeContext;
export type PluginDeactivateContext = PluginRuntimeContext;
export type PluginDisposeContext = PluginRuntimeContext;

export interface PluginModule {
  readonly manifest: PluginManifest;
  install?(ctx: PluginInstallContext): Promise<void> | void;
  register?(ctx: PluginRegisterContext): Promise<void> | void;
  activate?(ctx: PluginActivateContext): Promise<void> | void;
  deactivate?(ctx: PluginDeactivateContext): Promise<void> | void;
  dispose?(ctx: PluginDisposeContext): Promise<void> | void;
}

export type PluginState = "installed" | "registered" | "activated" | "deactivated" | "disposed";

export interface PluginRecord {
  readonly module: PluginModule;
  state: PluginState;
}

export interface PermissionTraceRecord {
  readonly pluginId: string;
  readonly permissions: PluginPermissions;
  readonly tracedAt: string;
}

export interface PluginManagerOptions {
  readonly appId: string;
  readonly projectId: string;
  readonly services?: ServiceRegistry;
  readonly extensions?: FrameworkExtensionRegistry;
  readonly eventBus?: EventBus<PluginEventMap>;
  readonly logger?: LoggerPort;
  readonly permissionTrace?: (record: PermissionTraceRecord) => void | Promise<void>;
}

export class PluginManager implements Disposable {
  public readonly services: ServiceRegistry;
  public readonly extensions: FrameworkExtensionRegistry;
  private readonly appId: string;
  private readonly eventBus: EventBus<PluginEventMap> | undefined;
  private readonly logger: LoggerPort | undefined;
  private readonly permissionTrace:
    | ((record: PermissionTraceRecord) => void | Promise<void>)
    | undefined;
  private readonly plugins = new Map<string, PluginRecord>();
  private readonly projectId: string;

  public constructor(options: PluginManagerOptions) {
    this.appId = options.appId;
    this.projectId = options.projectId;
    this.services = options.services ?? new ServiceRegistry();
    this.extensions = options.extensions ?? createFrameworkExtensionRegistry();
    this.eventBus = options.eventBus;
    this.logger = options.logger;
    this.permissionTrace = options.permissionTrace;
  }

  public async install(plugin: PluginModule): Promise<void> {
    validateManifest(plugin.manifest);
    if (this.plugins.has(plugin.manifest.id)) {
      throw new FrameworkError({
        category: "plugin",
        code: "plugin.duplicate",
        message: `Plugin already installed: ${plugin.manifest.id}`,
        metadata: { pluginId: plugin.manifest.id },
      });
    }

    this.plugins.set(plugin.manifest.id, { module: plugin, state: "installed" });
    await this.tracePermissions(plugin.manifest);
    await plugin.install?.(this.contextFor(plugin.manifest.id));
  }

  public async register(pluginId: string): Promise<void> {
    const record = this.requireRecord(pluginId);
    this.validateRequiredDependencies(record.module.manifest);
    this.registerManifestContributions(record.module.manifest);
    await record.module.register?.(this.contextFor(pluginId));
    record.state = "registered";
  }

  public async activate(pluginId: string): Promise<void> {
    const record = this.requireRecord(pluginId);
    try {
      await record.module.activate?.(this.contextFor(pluginId));
      record.state = "activated";
    } catch (error) {
      if (record.module.manifest.optional) {
        this.logger?.warn("Optional plugin activation failed", {
          eventId: "plugin.activate.failed",
          module: "plugin-system",
          action: "activate",
          data: { optional: true, pluginId },
        });
        return;
      }

      throw new FrameworkError({
        category: "plugin",
        cause: error,
        code: "plugin.activate.failed",
        message: `Plugin activation failed: ${pluginId}`,
        metadata: { pluginId },
        severity: "fatal",
      });
    }
  }

  public async deactivate(pluginId: string): Promise<void> {
    const record = this.requireRecord(pluginId);
    await record.module.deactivate?.(this.contextFor(pluginId));
    record.state = "deactivated";
  }

  public async disposePlugin(pluginId: string): Promise<void> {
    const record = this.requireRecord(pluginId);
    await record.module.dispose?.(this.contextFor(pluginId));
    await this.extensions.disposeOwner(pluginId);
    record.state = "disposed";
  }

  public async installAll(plugins: readonly PluginModule[]): Promise<void> {
    for (const plugin of plugins) {
      await this.install(plugin);
    }
  }

  public async registerAll(): Promise<void> {
    for (const pluginId of this.plugins.keys()) {
      await this.register(pluginId);
    }
  }

  public async activateAll(): Promise<void> {
    for (const pluginId of this.plugins.keys()) {
      await this.activate(pluginId);
    }
  }

  public getState(pluginId: string): PluginState | undefined {
    return this.plugins.get(pluginId)?.state;
  }

  public list(): readonly PluginManifest[] {
    return [...this.plugins.values()].map((record) => record.module.manifest);
  }

  public async dispose(): Promise<void> {
    for (const pluginId of [...this.plugins.keys()].reverse()) {
      await this.disposePlugin(pluginId);
    }
  }

  private registerManifestContributions(manifest: PluginManifest): void {
    const ownerPluginId = manifest.id;
    const version = manifest.version;
    const contributes = manifest.contributes;
    if (!contributes) {
      return;
    }

    registerAll(
      this.extensions.services,
      contributes.services,
      ownerPluginId,
      version,
      (item) => item.id,
    );
    registerAll(
      this.extensions.routes,
      contributes.routes,
      ownerPluginId,
      version,
      (item) => item.id,
    );
    registerAll(
      this.extensions.layouts,
      contributes.layouts,
      ownerPluginId,
      version,
      (item) => item.id,
    );
    registerAll(
      this.extensions.navigation,
      contributes.navigation,
      ownerPluginId,
      version,
      (item) => item.id,
    );
    registerAll(
      this.extensions.flows,
      contributes.flows,
      ownerPluginId,
      version,
      (item) => item.id,
    );
    registerAll(
      this.extensions.flowNodeHandlers,
      contributes.flowNodeHandlers,
      ownerPluginId,
      version,
      (item) => item.kind,
    );
    registerAll(
      this.extensions.flowNodeExecutors,
      contributes.flowNodeExecutors,
      ownerPluginId,
      version,
      (item) => item.kind,
    );
    registerAll(
      this.extensions.effectRunners,
      contributes.effectRunners,
      ownerPluginId,
      version,
      (item) => item.kind,
    );
    registerAll(
      this.extensions.commands,
      contributes.commands,
      ownerPluginId,
      version,
      (item) => item.id,
    );
    registerAll(
      this.extensions.commandMiddleware,
      contributes.commandMiddleware,
      ownerPluginId,
      version,
      (item) => item.id,
    );
    registerAll(
      this.extensions.conditions,
      contributes.conditions,
      ownerPluginId,
      version,
      (item) => item.id,
    );
    registerAll(
      this.extensions.validators,
      contributes.validators,
      ownerPluginId,
      version,
      (item) => item.id,
    );
    registerAll(
      this.extensions.devices,
      contributes.devices,
      ownerPluginId,
      version,
      (item) => item.type,
    );
    registerAll(
      this.extensions.inputSources,
      contributes.inputSources,
      ownerPluginId,
      version,
      (item) => item.kind,
    );
    registerAll(
      this.extensions.configProviders,
      contributes.configProviders,
      ownerPluginId,
      version,
      (item) => item.id,
    );
    registerAll(
      this.extensions.configSchema,
      contributes.configSchema,
      ownerPluginId,
      version,
      (item) => item.id,
    );
    registerAll(
      this.extensions.migrations,
      contributes.migrations,
      ownerPluginId,
      version,
      (item) => item.id,
    );
    registerAll(
      this.extensions.repositories,
      contributes.repositories,
      ownerPluginId,
      version,
      (item) => item.id,
    );
    registerAll(
      this.extensions.healthChecks,
      contributes.healthChecks,
      ownerPluginId,
      version,
      (item) => item.id,
    );
    registerAll(
      this.extensions.nativeExtensions,
      contributes.nativeExtensions,
      ownerPluginId,
      version,
      (item) => item.id,
    );
  }

  private validateRequiredDependencies(manifest: PluginManifest): void {
    for (const dependencyId of Object.keys(manifest.dependencies?.required ?? {})) {
      if (!this.plugins.has(dependencyId)) {
        throw new FrameworkError({
          category: "plugin",
          code: "plugin.dependency.missing",
          message: `Plugin ${manifest.id} requires missing plugin: ${dependencyId}`,
          metadata: { dependencyId, pluginId: manifest.id },
        });
      }
    }
  }

  private async tracePermissions(manifest: PluginManifest): Promise<void> {
    if (!manifest.permissions) {
      return;
    }

    const record = {
      permissions: manifest.permissions,
      pluginId: manifest.id,
      tracedAt: new Date().toISOString(),
    };
    await this.permissionTrace?.(record);
    this.logger?.warn("Plugin permissions are declaration-only in v1", {
      eventId: "plugin.permissions.warning",
      module: "plugin-system",
      action: "trace-permissions",
      data: { pluginId: manifest.id, permissions: manifest.permissions },
    });
    await this.eventBus?.publish("plugin.permissions.warning", record, {
      source: "plugin",
      sourceId: manifest.id,
    });
  }

  private contextFor(pluginId: string): PluginRuntimeContext {
    return {
      appId: this.appId,
      eventBus: this.eventBus,
      extensions: this.extensions,
      logger: this.logger,
      pluginId,
      projectId: this.projectId,
      services: this.services,
    };
  }

  private requireRecord(pluginId: string): PluginRecord {
    const record = this.plugins.get(pluginId);
    if (!record) {
      throw new FrameworkError({
        category: "plugin",
        code: "plugin.missing",
        message: `Plugin is not installed: ${pluginId}`,
        metadata: { pluginId },
      });
    }

    return record;
  }
}

const registerAll = <TContribution>(
  registry: {
    register: (registration: {
      id: string;
      ownerPluginId: string;
      version: string;
      value: TContribution;
    }) => void;
  },
  contributions: readonly TContribution[] | undefined,
  ownerPluginId: string,
  version: string,
  getId: (contribution: TContribution) => string,
): void => {
  for (const contribution of contributions ?? []) {
    registry.register({
      id: getId(contribution),
      ownerPluginId,
      value: contribution,
      version,
    });
  }
};

const validateManifest = (manifest: PluginManifest): void => {
  if (!manifest.id || !manifest.name || !manifest.version || manifest.type.length === 0) {
    throw new FrameworkError({
      category: "plugin",
      code: "plugin.manifest.invalid",
      message: "Plugin manifest requires id, name, version, and at least one type.",
      metadata: { pluginId: manifest.id || "unknown" },
    });
  }
};
