import type { CommandMiddleware } from "@tripley-kit/web-container-command-system";
import type { FlowPolicies } from "@tripley-kit/web-container-flow-engine";

import { kioskStandardMigrations } from "./migrations";
import type { HealthCheck } from "./services";

export interface ProjectPreset {
  readonly id: string;
  readonly version: string;
  readonly requiredNativeCapabilities: readonly string[];
  readonly plugins: readonly string[];
  readonly configuration: ConfigurationPreset;
  readonly logging: LoggingPreset;
  readonly storage: StoragePreset;
  readonly windows: WindowLayoutPreset;
  readonly flowPolicies: FlowPolicies;
  readonly commandMiddleware: readonly CommandMiddleware[];
  readonly healthChecks: readonly HealthCheck[];
}

export interface ConfigurationPreset {
  readonly featureFlags: Record<string, boolean>;
  readonly locale: string;
}

export interface LoggingPreset {
  readonly module: string;
  readonly safeSummariesOnly: boolean;
}

export interface StoragePreset {
  readonly sqliteRequired: boolean;
  readonly migrations: readonly { readonly id: string; readonly packageId: string }[];
}

export interface WindowLayoutPreset {
  readonly topology: "single-screen" | "multi-screen";
  readonly windowMode: "single-root-route-switch" | "dedicated-root-per-display";
  readonly rootWindows: Record<string, RootWindowPreset>;
}

export interface RootWindowPreset {
  readonly windowKey: string;
  readonly path: string;
  readonly displayRole: "front" | "rear" | "top" | (string & {});
  readonly launch: "onBoot" | "onDemand" | "disabled";
  readonly features?: {
    readonly fullscreen?: boolean | undefined;
    readonly frame?: boolean | undefined;
    readonly resizable?: boolean | undefined;
    readonly alwaysOnTop?: boolean | undefined;
  };
}

export const singleScreenKioskConfig: WindowLayoutPreset = {
  rootWindows: {
    main: {
      displayRole: "front",
      features: { alwaysOnTop: false, frame: false, fullscreen: true, resizable: false },
      launch: "onBoot",
      path: "/customer/idle",
      windowKey: "kiosk.main",
    },
  },
  topology: "single-screen",
  windowMode: "single-root-route-switch",
};

export const createKioskProjectPreset = (
  overrides: Partial<ProjectPreset> = {},
): ProjectPreset => ({
  commandMiddleware: overrides.commandMiddleware ?? [],
  configuration: overrides.configuration ?? {
    featureFlags: {
      "features.withdrawal.enabled": true,
      "features.withdrawal.qrInput.enabled": true,
    },
    locale: "en",
  },
  flowPolicies: overrides.flowPolicies ?? {
    interrupts: [
      {
        action: { reasonCode: "CARD.REMOVED", type: "cancelFlow" },
        eventTopic: "device.card.removed",
        id: "card.removed",
        priority: 100,
      },
    ],
    userInputTimeout: {
      onTimeout: { nodeId: "returnToIdle", type: "next" },
      timeoutMs: 30_000,
    },
  },
  healthChecks: overrides.healthChecks ?? [],
  id: overrides.id ?? "kiosk.base",
  logging: overrides.logging ?? {
    module: "kiosk-base",
    safeSummariesOnly: true,
  },
  plugins: overrides.plugins ?? [],
  requiredNativeCapabilities: overrides.requiredNativeCapabilities ?? [
    "window.open",
    "display.list",
    "sqlite",
  ],
  storage: overrides.storage ?? {
    migrations: kioskStandardMigrations.map((migration) => ({
      id: migration.id,
      packageId: migration.packageId,
    })),
    sqliteRequired: true,
  },
  version: overrides.version ?? "0.1.0",
  windows: overrides.windows ?? singleScreenKioskConfig,
});

export interface KioskProjectBlueprint {
  readonly preset: ProjectPreset;
  readonly repositories: readonly string[];
  readonly services: readonly string[];
  readonly extensionPoints: readonly string[];
}

export const createKioskProjectBlueprint = (
  preset: ProjectPreset = createKioskProjectPreset(),
): KioskProjectBlueprint => ({
  extensionPoints: [
    "commands",
    "conditions",
    "flows",
    "inputSources",
    "devices",
    "healthChecks",
    "repositories",
    "migrations",
  ],
  preset,
  repositories: [
    "kiosk.transaction",
    "kiosk.transactionMessage",
    "kiosk.auditJournal",
    "kiosk.operationLedger",
  ],
  services: [
    "auditJournal",
    "accessibility",
    "businessCalendar",
    "featureFlags",
    "promptCatalog",
    "health",
    "operationLedger",
    "outbox",
  ],
});

export interface ProjectExtension {
  readonly id: string;
  readonly commands?: readonly string[] | undefined;
  readonly conditions?: readonly string[] | undefined;
  readonly inputSources?: readonly string[] | undefined;
  readonly migrations?: readonly string[] | undefined;
}

export const addProjectExtension = (
  blueprint: KioskProjectBlueprint,
  extension: ProjectExtension,
): KioskProjectBlueprint => ({
  ...blueprint,
  extensionPoints: [...blueprint.extensionPoints, `project:${extension.id}`],
});
