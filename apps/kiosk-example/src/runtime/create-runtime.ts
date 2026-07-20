import {
  DeviceLockManager,
  DeviceRegistry,
  InputSourceRegistry,
} from "@tripley/web-container-device-core";
import {
  AuditJournalService,
  InMemoryAuditJournalRepository,
  InMemoryOperationLedger,
} from "@tripley/web-container-kiosk-base";
import {
  type CashRuntimeSafetyPolicy,
  type CapabilityStatus,
  type KioskLauncherSupervisionPort,
  type KioskRuntimeMode,
  type OperationViewState,
  type RecoveryStartupBarrierPort,
  createKioskRuntime,
} from "@tripley/web-container-kiosk-runtime";
import { ConsoleLogger } from "@tripley/web-container-logging";
import {
  AudioAssetCatalog,
  PromptDefinitionCatalog,
  PromptPresenter,
} from "@tripley/web-container-prompt-presentation";
import { MemoryScopedStore } from "@tripley/web-container-scoped-store";
import { BrowserSpeechSynthesisTtsAdapter } from "@tripley/web-container-tts";
import { FrameworkUiPort, ZustandUiStateAdapter } from "@tripley/web-container-ui-port";
import { createStore } from "zustand/vanilla";

import {
  type ContributionDependencies,
  collectWithdrawalAmount,
  createContactCardEntry,
  createContributionDependencies,
  createOnlinePinChallenge,
  createQrEntry,
  createReservationEntry,
} from "./contributions";
import {
  type HostdDeviceComposition,
  type HostdHealthSnapshot,
  type HostdRuntimeConfig,
  connectHostdDevices,
} from "./hostd";
import { UiInputBroker } from "./input-broker";
import type { ExampleApplicationRuntime } from "./types";

export interface CreateExampleRuntimeOptions {
  readonly mode: KioskRuntimeMode;
  readonly hostd?: Partial<HostdRuntimeConfig> | undefined;
  readonly connectHostd?: typeof connectHostdDevices | undefined;
  readonly healthPollIntervalMs?: number | undefined;
  readonly reservationEnabled?: boolean | undefined;
  readonly speechRequired?: boolean | undefined;
  readonly cashSafety?: CashRuntimeSafetyPolicy | undefined;
  readonly launcherSupervision?: KioskLauncherSupervisionPort | undefined;
  readonly recoveryStartup?: RecoveryStartupBarrierPort | undefined;
  readonly extensions?: readonly ExampleRuntimeExtension[] | undefined;
  readonly onReboot?: ((mode: KioskRuntimeMode) => void | Promise<void>) | undefined;
}

export interface ExampleRuntimeExtension {
  readonly id: string;
  readonly capabilities?: Readonly<Record<string, CapabilityStatus>> | undefined;
  register(context: {
    readonly devices: DeviceRegistry;
    readonly inputSources: InputSourceRegistry;
  }): void | Promise<void>;
  createEntryMethods(
    dependencies: ContributionDependencies,
  ): readonly ReturnType<typeof createContactCardEntry>[];
}

export const createExampleApplicationRuntime = async (
  options: CreateExampleRuntimeOptions,
): Promise<ExampleApplicationRuntime> => {
  const store = createStore<Record<string, unknown>>(() => ({}));
  const ui = new FrameworkUiPort({ navigate: () => {} }, new ZustandUiStateAdapter(store));
  const scopedStore = new MemoryScopedStore();
  const devices = new DeviceRegistry();
  const inputSources = new InputSourceRegistry();
  const locks = new DeviceLockManager();
  const broker = new UiInputBroker();
  inputSources.register(broker.createAdapter("ui.command"));
  let bootstrapError: string | undefined;
  let disposeDevices: (() => Promise<void>) | undefined;
  let hostdComposition: HostdDeviceComposition | undefined;
  let healthTimer: ReturnType<typeof setInterval> | undefined;
  let healthSnapshot: HostdHealthSnapshot | undefined;
  let capabilities: Readonly<Record<string, CapabilityStatus>> = {};
  const hostd = hostdConfig(options.hostd);

  if (options.mode === "memory") {
    inputSources.register(broker.createAdapter("barcodeReader.qr"));
    inputSources.register(createMemoryPinAdapter(broker));
  } else {
    try {
      const composition = await (options.connectHostd ?? connectHostdDevices)(
        hostd,
        devices,
        inputSources,
      );
      hostdComposition = composition;
      capabilities = composition.capabilities;
      healthSnapshot = composition.health;
      disposeDevices = composition.dispose;
    } catch (error) {
      bootstrapError = error instanceof Error ? error.message : String(error);
    }
  }

  for (const extension of options.extensions ?? []) {
    await extension.register({ devices, inputSources });
    capabilities = { ...capabilities, ...extension.capabilities };
  }

  const dependencies = createContributionDependencies({
    broker,
    devices,
    inputSources,
    locks,
    mode: options.mode,
    pinOptions: {
      activeKeys: 0x07ff,
      customerData: hostd.pinCustomerData,
      format: 2,
      keyName: hostd.pinKeyName,
      terminateKeys: 0x0400,
    },
  });
  const prompt = createPromptPresenter(options.speechRequired === true);
  const promptReadiness = await prompt.checkReadiness({
    speechRequired: options.speechRequired === true,
  });
  capabilities = {
    ...capabilities,
    "prompt.presentation":
      promptReadiness.status === "ready"
        ? "available"
        : promptReadiness.status === "degraded"
          ? "degraded"
          : "unavailable",
  };
  const entries = [
    createContactCardEntry(dependencies),
    createQrEntry(dependencies),
    ...(options.reservationEnabled === false ? [] : [createReservationEntry(dependencies)]),
    ...(options.extensions ?? []).flatMap((extension) =>
      extension.createEntryMethods(dependencies),
    ),
  ];
  const runtime = createKioskRuntime({
    authenticationChallenges: [createOnlinePinChallenge(dependencies)],
    cashSafety: options.cashSafety,
    capabilities,
    entryMethods: entries,
    executeBusiness: async (_ctx, assessment) => ({
      approved: true,
      entryMethodId: assessment.credential.entryMethodId,
    }),
    mode: options.mode,
    operationIdFactory: createOperationId,
    promptIntent: createPromptIntent,
    requiredCapabilities: options.speechRequired ? ["prompt.presentation"] : [],
    policy: {
      attemptBudgets: {
        "pin.online": 3,
        "reservation.number": 3,
        "reservation.secret": 3,
        "withdrawal.amount": 3,
      },
      interactionTimeouts: { input: 30_000 },
      operationDeadlineMs: 120_000,
    },
    ports: {
      audit: new AuditJournalService(new InMemoryAuditJournalRepository()),
      ledger: new InMemoryOperationLedger(),
      logger: typeof window === "undefined" ? undefined : new ConsoleLogger(),
      launcherSupervision: options.launcherSupervision,
      prompt,
      recoveryStartup: options.recoveryStartup,
      scopedStore,
      ui,
    },
    prepareOperation: async (ctx) => {
      const amount = await collectWithdrawalAmount(ctx, dependencies);
      scopedStore.scope("transaction", ctx.operationId).set("withdrawal.amount", amount);
    },
  });
  let disposed = false;
  const disposeApplication = async (): Promise<void> => {
    if (disposed) {
      return;
    }
    disposed = true;
    if (healthTimer) {
      clearInterval(healthTimer);
    }
    await runtime.dispose();
    await disposeDevices?.();
  };
  const rebootApplication = async (mode: KioskRuntimeMode): Promise<void> => {
    await disposeApplication();
    await options.onReboot?.(mode);
  };
  runtime.commands.register({
    execute: async (_ctx, input: { value?: string; secureConfirmation?: boolean }) => {
      if (input.secureConfirmation) {
        broker.submitSecureConfirmation();
      } else {
        broker.submit(input.value ?? "");
      }
      return { accepted: true };
    },
    id: "kiosk.input.submit",
  });
  runtime.commands.register({
    execute: async () => runtime.interrupt("user.cancelled"),
    id: "kiosk.operation.cancel",
  });
  runtime.commands.register({
    execute: async (_ctx, input: { mode: KioskRuntimeMode }) => {
      await rebootApplication(input.mode);
      return { mode: input.mode, rebootRequested: true };
    },
    id: "kiosk.runtime.reboot",
  });
  await runtime.initialize();
  if (hostdComposition) {
    let checking = false;
    healthTimer = setInterval(async () => {
      if (checking) {
        return;
      }
      checking = true;
      try {
        healthSnapshot = await hostdComposition?.checkCapabilities();
        if (!healthSnapshot) {
          return;
        }
        capabilities = { ...capabilities, ...healthSnapshot.capabilities };
        await runtime.refreshCapabilities(capabilities);
        if (Object.values(healthSnapshot.capabilities).includes("unavailable")) {
          clearInterval(healthTimer);
          healthTimer = undefined;
        }
      } catch {
        const unavailable = {
          ...capabilities,
          ...Object.fromEntries(
            Object.keys(hostdComposition.capabilities).map((capabilityId) => [
              capabilityId,
              "unavailable",
            ]),
          ),
        } as Readonly<Record<string, CapabilityStatus>>;
        await runtime.refreshCapabilities(unavailable);
        clearInterval(healthTimer);
        healthTimer = undefined;
      } finally {
        checking = false;
      }
    }, options.healthPollIntervalMs ?? 5_000);
  }

  return {
    commands: runtime.commands,
    diagnostics: {
      bootstrapError,
      get health() {
        return healthSnapshot
          ? { checkedAt: healthSnapshot.checkedAt, checks: healthSnapshot.checks }
          : undefined;
      },
      hostdUrl: options.mode === "hostd" ? hostd.url : undefined,
      logicalServices: {
        ...(hostd.idcLogicalName ? { idc: hostd.idcLogicalName } : {}),
        ...(hostd.pinLogicalName ? { pin: hostd.pinLogicalName } : {}),
        ...(hostd.bcrLogicalName ? { bcr: hostd.bcrLogicalName } : {}),
      },
    },
    dispose: disposeApplication,
    mode: options.mode,
    operationStateKey,
    runtime,
    reboot: rebootApplication,
    store,
  };
};

export const runtimeModeFromLocation = (location: Pick<Location, "search">): KioskRuntimeMode =>
  new URLSearchParams(location.search).get("mode") === "hostd" ? "hostd" : "memory";

export const operationStateKey = JSON.stringify({ key: "kiosk.operation" });

const hostdConfig = (overrides: Partial<HostdRuntimeConfig> = {}): HostdRuntimeConfig => ({
  url: overrides.url ?? import.meta.env.VITE_TRIPLEY_NATIVE_HOSTD_URL ?? "ws://127.0.0.1:39010",
  idcLogicalName: overrides.idcLogicalName ?? import.meta.env.VITE_XFS_IDC_LOGICAL_NAME ?? "",
  pinLogicalName: overrides.pinLogicalName ?? import.meta.env.VITE_XFS_PIN_LOGICAL_NAME ?? "",
  pinCustomerData:
    overrides.pinCustomerData ?? import.meta.env.VITE_XFS_PIN_CUSTOMER_DATA ?? "123456789012",
  pinKeyName:
    overrides.pinKeyName ?? import.meta.env.VITE_XFS_PIN_KEY_NAME ?? "TripleyConformanceCrypt",
  ...((overrides.authToken ?? import.meta.env.VITE_TRIPLEY_NATIVE_HOSTD_AUTH_TOKEN)
    ? { authToken: overrides.authToken ?? import.meta.env.VITE_TRIPLEY_NATIVE_HOSTD_AUTH_TOKEN }
    : {}),
  ...((overrides.bcrLogicalName ?? import.meta.env.VITE_XFS_BCR_LOGICAL_NAME)
    ? { bcrLogicalName: overrides.bcrLogicalName ?? import.meta.env.VITE_XFS_BCR_LOGICAL_NAME }
    : {}),
});

const createMemoryPinAdapter = (broker: UiInputBroker) => {
  const adapter = broker.createAdapter("pinpad.pin");
  return {
    ...adapter,
    start: async (
      ctx: Parameters<typeof adapter.start>[0],
      source: Parameters<typeof adapter.start>[1],
    ) => {
      ctx;
      return broker.createAdapter("pinpad.pin").start(ctx, source);
    },
  };
};

const createPromptPresenter = (speechRequired: boolean): PromptPresenter => {
  const prompts = new PromptDefinitionCatalog();
  for (const prompt of [
    { id: "card.take", text: "Please take your card" },
    { id: "pin.enter", text: "Enter your PIN on the secure keypad" },
  ]) {
    prompts.register({
      ...prompt,
      locale: "en",
      playbackPolicy: speechRequired ? "ttsRequired" : "visualOnly",
    });
  }
  return new PromptPresenter({
    assets: new AudioAssetCatalog(),
    prompts,
    tts: new BrowserSpeechSynthesisTtsAdapter(),
  });
};

let operationSequence = 1;
const createOperationId = (): string => `kiosk-operation-${operationSequence++}`;

const createPromptIntent = (state: OperationViewState) => {
  if (!state.operationId || !state.promptId || !audiblePromptIds.has(state.promptId)) {
    return undefined;
  }
  return {
    locale: "en",
    operationId: state.operationId,
    priority: state.promptId === "card.take" ? ("safety" as const) : ("instruction" as const),
    promptId: state.promptId,
    viewRevision: state.revision,
  };
};

const audiblePromptIds = new Set(["card.take", "pin.enter"]);
