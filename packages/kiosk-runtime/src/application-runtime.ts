import { CommandRegistry } from "@tripley-kit/web-container-command-system";
import { ConditionRegistry } from "@tripley-kit/web-container-condition-engine";
import {
  DeviceLockManager,
  DeviceRegistry,
  InputSourceRegistry,
} from "@tripley-kit/web-container-device-core";
import { FrameworkError } from "@tripley-kit/web-container-errors";
import {
  LocalEventBus,
  type EventBus,
} from "@tripley-kit/web-container-event-bus";
import {
  UiPortFlowProjectionAdapter,
  createFlowEngine,
} from "@tripley-kit/web-container-flow-engine";
import { HealthCheckCenter } from "@tripley-kit/web-container-kiosk-base";
import { PluginManager, type PluginModule } from "@tripley-kit/web-container-plugin-system";
import { MemoryScopedStore } from "@tripley-kit/web-container-scoped-store";
import {
  FrameworkUiPort,
  LayoutContributionRegistry,
  MenuContributionRegistry,
  RouteContributionRegistry,
  RouteGuardRegistry,
} from "@tripley-kit/web-container-ui-port";

import { bindApplicationContributions } from "./application-contributions";
import type {
  CreateKioskApplicationRuntimeOptions,
  KioskApplicationLifecycleEventMap,
  KioskApplicationLifecyclePayload,
  KioskApplicationRuntime,
} from "./application-runtime-types";

export const createKioskApplicationRuntime = async <
  EventMap extends KioskApplicationLifecycleEventMap = KioskApplicationLifecycleEventMap,
>(
  options: CreateKioskApplicationRuntimeOptions<EventMap>,
): Promise<KioskApplicationRuntime<EventMap>> => {
  const eventBus = options.ports?.eventBus ?? new LocalEventBus<EventMap>();
  const commands = new CommandRegistry();
  const conditions = new ConditionRegistry();
  const devices = options.ports?.devices ?? new DeviceRegistry();
  const inputSources = options.ports?.inputSources ?? new InputSourceRegistry();
  const deviceLocks = options.ports?.deviceLocks ?? new DeviceLockManager();
  const scopedStore = options.ports?.scopedStore ?? new MemoryScopedStore();
  const ui = options.ports?.ui ?? new FrameworkUiPort({ navigate: () => undefined });
  const routes = new RouteContributionRegistry();
  const layouts = new LayoutContributionRegistry();
  const navigation = new MenuContributionRegistry();
  const routeGuards = new RouteGuardRegistry();
  const healthChecks = new HealthCheckCenter();
  const flowEngine = createFlowEngine({
    defaultPolicies: options.preset.flowPolicies,
    deviceLocks,
    devices,
    inputSources,
    projection: new UiPortFlowProjectionAdapter(ui),
    scopedStore,
  });
  const lifecycle = lifecyclePayload(options);
  const pluginManager = new PluginManager({
    appId: options.appId,
    eventBus,
    projectId: options.projectId,
    ...(options.ports?.logger ? { logger: options.ports.logger } : {}),
    runtimeContext: {
      ...options.ports?.pluginContext,
      capabilities: options.capabilities ?? {},
      commands,
      conditions,
      deviceLocks,
      devices,
      flowEngine,
      healthChecks,
      inputSources,
      layouts,
      navigation,
      preset: options.preset,
      routeGuards,
      routes,
      scopedStore,
      ui,
    },
  });

  await eventBus.publish("core.app.initializing", lifecycle, { source: "core" });
  try {
    validateCapabilities(options);
    const plugins = selectPresetPlugins(options.preset.plugins, options.plugins);
    for (const middleware of options.preset.commandMiddleware) {
      commands.registerMiddleware(middleware);
    }
    for (const check of options.preset.healthChecks) {
      healthChecks.register(check);
    }
    await pluginManager.installAll(plugins);
    await pluginManager.registerAll();
    await pluginManager.activateAll();
    bindApplicationContributions(pluginManager.extensions, {
      commands,
      conditions,
      flowEngine,
      healthChecks,
      inputSources,
      layouts,
      navigation,
      routes,
    });
    await eventBus.publish("core.app.ready", lifecycle, { source: "core" });
  } catch (error) {
    await eventBus.publish(
      "core.app.failed",
      { ...lifecycle, reasonCode: errorCode(error) },
      { source: "core" },
    ).catch(() => undefined);
    await pluginManager.dispose().catch(() => undefined);
    await flowEngine.dispose().catch(() => undefined);
    await Promise.resolve(eventBus.dispose()).catch(() => undefined);
    throw error;
  }

  let disposed = false;
  return {
    appId: options.appId,
    commands,
    conditions,
    deviceLocks,
    devices,
    eventBus,
    extensions: pluginManager.extensions,
    flowEngine,
    healthChecks,
    inputSources,
    layouts,
    navigation,
    pluginManager,
    preset: options.preset,
    projectId: options.projectId,
    routeGuards,
    routes,
    scopedStore,
    ui,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      await disposeApplicationRuntime(
        pluginManager,
        flowEngine,
        eventBus,
        lifecycle,
      );
    },
  };
};

const disposeApplicationRuntime = async <
  EventMap extends KioskApplicationLifecycleEventMap,
>(
  pluginManager: PluginManager,
  flowEngine: ReturnType<typeof createFlowEngine>,
  eventBus: EventBus<EventMap>,
  lifecycle: KioskApplicationLifecyclePayload,
): Promise<void> => {
  const errors: unknown[] = [];
  for (const operation of [
    () => pluginManager.dispose(),
    () => flowEngine.dispose(),
    () => eventBus.publish("core.app.disposed", lifecycle, { source: "core" }),
    () => eventBus.dispose(),
  ]) {
    try {
      await operation();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Kiosk application runtime disposal failed.");
  }
};

const validateCapabilities = <EventMap extends KioskApplicationLifecycleEventMap>(
  options: CreateKioskApplicationRuntimeOptions<EventMap>,
): void => {
  const required = new Set(options.preset.requiredNativeCapabilities);
  if (options.preset.storage.sqliteRequired) required.add("sqlite");
  const missing = [...required].filter(
    (capability) => options.capabilities?.[capability] === undefined ||
      options.capabilities[capability] === "unavailable",
  );
  if (missing.length > 0) {
    throw new FrameworkError({
      category: "configuration",
      code: "kiosk.application.capability.missing",
      message: `Required kiosk capabilities are unavailable: ${missing.join(", ")}`,
      metadata: { missingCapabilities: missing },
      severity: "fatal",
    });
  }
};

const selectPresetPlugins = (
  pluginIds: readonly string[],
  catalog: readonly PluginModule[],
): readonly PluginModule[] => {
  const duplicates = pluginIds.filter((id, index) => pluginIds.indexOf(id) !== index);
  if (duplicates.length > 0) {
    throw new FrameworkError({
      category: "configuration",
      code: "kiosk.application.plugin.duplicate",
      message: `Project preset contains duplicate plugins: ${duplicates.join(", ")}`,
    });
  }
  const byId = new Map(catalog.map((plugin) => [plugin.manifest.id, plugin]));
  const missing = pluginIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new FrameworkError({
      category: "configuration",
      code: "kiosk.application.plugin.missing",
      message: `Project preset plugins are missing from the catalog: ${missing.join(", ")}`,
      severity: "fatal",
    });
  }
  return pluginIds.map((id) => byId.get(id)!);
};

const lifecyclePayload = <EventMap extends KioskApplicationLifecycleEventMap>(
  options: CreateKioskApplicationRuntimeOptions<EventMap>,
): KioskApplicationLifecyclePayload => ({
  appId: options.appId,
  presetId: options.preset.id,
  presetVersion: options.preset.version,
  projectId: options.projectId,
});

const errorCode = (error: unknown): string =>
  error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "kiosk.application.startup.failed";
