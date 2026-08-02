import type { CommandRegistry } from "@tripley-kit/web-container-command-system";
import type { ConditionRegistry } from "@tripley-kit/web-container-condition-engine";
import type {
  DeviceLockManager,
  DeviceRegistry,
  InputSourceRegistry,
} from "@tripley-kit/web-container-device-core";
import {
  createKioskProjectPreset,
  type HealthCheckCenter,
} from "@tripley-kit/web-container-kiosk-base";
import {
  createKioskApplicationRuntime,
  type KioskApplicationLifecycleEventMap,
  type KioskApplicationRuntime,
} from "@tripley-kit/web-container-kiosk-runtime";
import type {
  PluginModule,
  PluginRuntimeContext,
} from "@tripley-kit/web-container-plugin-system";
import type { ScopedStore } from "@tripley-kit/web-container-scoped-store";
import type { UiPort } from "@tripley-kit/web-container-ui-port";

export const EXAMPLE_FOUNDATION_PLUGIN_ID = "kiosk-example.foundation";
export const EXAMPLE_READY_CONDITION_ID = "kiosk-example.runtime.ready";
export const EXAMPLE_STATUS_COMMAND_ID = "kiosk-example.runtime.status";

export interface ExampleApplicationEventMap extends KioskApplicationLifecycleEventMap {
  readonly "project.kiosk.runtime.ready": {
    readonly appId: string;
    readonly mode: string;
  };
}

export const exampleProjectPreset = createKioskProjectPreset({
  id: "kiosk-example",
  version: "0.2.0",
  plugins: [EXAMPLE_FOUNDATION_PLUGIN_ID],
  requiredNativeCapabilities: [],
  storage: { migrations: [], sqliteRequired: false },
});

const requirePort = <T>(context: PluginRuntimeContext, name: string): T => {
  const port = context[name];
  if (port === undefined) {
    throw new Error(`Kiosk example plugin requires runtime port: ${name}`);
  }
  return port as T;
};

export const exampleFoundationPlugin: PluginModule = {
  manifest: {
    id: EXAMPLE_FOUNDATION_PLUGIN_ID,
    name: "Kiosk Example Foundation",
    type: ["project-preset", "command", "condition"],
    version: "0.2.0",
  },
  register(context) {
    const commands = requirePort<CommandRegistry>(context, "commands");
    const conditions = requirePort<ConditionRegistry>(context, "conditions");
    const healthChecks = requirePort<HealthCheckCenter>(context, "healthChecks");

    conditions.register(
      { id: EXAMPLE_READY_CONDITION_ID, evaluate: () => true },
      { ownerPluginId: context.pluginId },
    );
    commands.register({
      id: EXAMPLE_STATUS_COMMAND_ID,
      title: "Read kiosk example runtime status",
      canExecute: (commandContext) =>
        commandContext.conditions?.evaluate(EXAMPLE_READY_CONDITION_ID, commandContext) ?? {
          allowed: false,
          reasonCode: "condition.registry.missing",
        },
      execute: async () => ({ ready: true as const }),
    });
    healthChecks.register({
      id: "kiosk-example.application",
      run: async () => ({ id: "kiosk-example.application", status: "pass" }),
    });
  },
};

export interface ExampleFrameworkApplicationPorts {
  readonly deviceLocks: DeviceLockManager;
  readonly devices: DeviceRegistry;
  readonly inputSources: InputSourceRegistry;
  readonly scopedStore: ScopedStore;
  readonly ui: UiPort;
}

export const createExampleFrameworkApplication = (
  ports: ExampleFrameworkApplicationPorts,
): Promise<KioskApplicationRuntime<ExampleApplicationEventMap>> =>
  createKioskApplicationRuntime<ExampleApplicationEventMap>({
    appId: "kiosk-example",
    plugins: [exampleFoundationPlugin],
    preset: exampleProjectPreset,
    projectId: "kiosk-example",
    ports,
  });
