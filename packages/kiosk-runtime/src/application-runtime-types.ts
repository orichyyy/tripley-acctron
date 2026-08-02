import type { CommandRegistry } from "@tripley-kit/web-container-command-system";
import type { ConditionRegistry } from "@tripley-kit/web-container-condition-engine";
import type {
  DeviceLockManager,
  DeviceRegistry,
  InputSourceRegistry,
} from "@tripley-kit/web-container-device-core";
import type { EventBus } from "@tripley-kit/web-container-event-bus";
import type { ExecutableFlowEngine } from "@tripley-kit/web-container-flow-engine";
import type {
  HealthCheckCenter,
  ProjectPreset,
} from "@tripley-kit/web-container-kiosk-base";
import type { LoggerPort } from "@tripley-kit/web-container-logging";
import type {
  PromptDefinitionCatalog,
  PromptPresenterPort,
} from "@tripley-kit/web-container-prompt-presentation";
import type {
  FrameworkExtensionRegistry,
  PluginManager,
  PluginModule,
} from "@tripley-kit/web-container-plugin-system";
import type { ScopedStore } from "@tripley-kit/web-container-scoped-store";
import type { TtsPort } from "@tripley-kit/web-container-tts";
import type {
  LayoutContributionRegistry,
  MenuContributionRegistry,
  RouteContributionRegistry,
  RouteGuardRegistry,
  UiPort,
} from "@tripley-kit/web-container-ui-port";
import type {
  DisplayPort,
  WindowPort,
} from "@tripley-kit/web-container-window-manager";

import type { CapabilityStatus } from "./types";

export interface KioskApplicationLifecycleEventMap {
  readonly "core.app.initializing": KioskApplicationLifecyclePayload;
  readonly "core.app.ready": KioskApplicationLifecyclePayload;
  readonly "core.app.failed": KioskApplicationFailurePayload;
  readonly "core.app.disposed": KioskApplicationLifecyclePayload;
  readonly [topic: string]: unknown;
}

export interface KioskApplicationLifecyclePayload {
  readonly appId: string;
  readonly presetId: string;
  readonly presetVersion: string;
  readonly projectId: string;
}

export interface KioskApplicationFailurePayload
  extends KioskApplicationLifecyclePayload {
  readonly reasonCode: string;
}

export interface KioskApplicationPlatformPorts<
  EventMap extends KioskApplicationLifecycleEventMap,
> {
  readonly eventBus?: EventBus<EventMap> | undefined;
  readonly logger?: LoggerPort | undefined;
  readonly ui?: UiPort | undefined;
  readonly devices?: DeviceRegistry | undefined;
  readonly inputSources?: InputSourceRegistry | undefined;
  readonly deviceLocks?: DeviceLockManager | undefined;
  readonly scopedStore?: ScopedStore | undefined;
  readonly pluginContext?: Readonly<Record<string, unknown>> | undefined;
  readonly display?: DisplayPort | undefined;
  readonly prompt?: PromptPresenterPort | undefined;
  readonly prompts?: PromptDefinitionCatalog | undefined;
  readonly tts?: TtsPort | undefined;
  readonly window?: WindowPort | undefined;
}

export interface CreateKioskApplicationRuntimeOptions<
  EventMap extends KioskApplicationLifecycleEventMap,
> {
  readonly appId: string;
  readonly projectId: string;
  readonly preset: ProjectPreset;
  readonly plugins: readonly PluginModule[];
  readonly capabilities?: Readonly<Record<string, CapabilityStatus>> | undefined;
  readonly ports?: KioskApplicationPlatformPorts<EventMap> | undefined;
}

export interface KioskApplicationRuntime<
  EventMap extends KioskApplicationLifecycleEventMap,
> {
  readonly appId: string;
  readonly projectId: string;
  readonly preset: ProjectPreset;
  readonly eventBus: EventBus<EventMap>;
  readonly commands: CommandRegistry;
  readonly conditions: ConditionRegistry;
  readonly devices: DeviceRegistry;
  readonly inputSources: InputSourceRegistry;
  readonly deviceLocks: DeviceLockManager;
  readonly scopedStore: ScopedStore;
  readonly flowEngine: ExecutableFlowEngine;
  readonly healthChecks: HealthCheckCenter;
  readonly pluginManager: PluginManager;
  readonly extensions: FrameworkExtensionRegistry;
  readonly ui: UiPort;
  readonly routes: RouteContributionRegistry;
  readonly layouts: LayoutContributionRegistry;
  readonly navigation: MenuContributionRegistry;
  readonly routeGuards: RouteGuardRegistry;
  readonly display?: DisplayPort | undefined;
  readonly prompt?: PromptPresenterPort | undefined;
  readonly prompts: PromptDefinitionCatalog;
  readonly tts?: TtsPort | undefined;
  readonly window?: WindowPort | undefined;
  dispose(): Promise<void>;
}
