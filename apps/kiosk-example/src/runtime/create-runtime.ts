import {
  CorrelatedInputSourceBroker,
  DeviceLockManager,
  DeviceRegistry,
  InputSourceRegistry,
  type SecurePinInputResult,
} from "@tripley-kit/web-container-device-core";
import {
  UiPortFlowProjectionAdapter,
  createFlowEngine,
} from "@tripley-kit/web-container-flow-engine";
import {
  AuditJournalService,
  InMemoryAuditJournalRepository,
  InMemoryOperationLedger,
} from "@tripley-kit/web-container-kiosk-base";
import {
  type CashRuntimeSafetyPolicy,
  type CapabilityStatus,
  type CredentialAssessment,
  type KioskLauncherSupervisionPort,
  type KioskRuntimeMode,
  type OperationViewState,
  type RecoveryStartupBarrierPort,
  createKioskRuntime,
} from "@tripley-kit/web-container-kiosk-runtime";
import { ConsoleLogger } from "@tripley-kit/web-container-logging";
import {
  AudioAssetCatalog,
  PromptDefinitionCatalog,
  PromptPresenter,
} from "@tripley-kit/web-container-prompt-presentation";
import { MemoryScopedStore } from "@tripley-kit/web-container-scoped-store";
import { BrowserSpeechSynthesisTtsAdapter } from "@tripley-kit/web-container-tts";
import { FrameworkUiPort, ZustandUiStateAdapter } from "@tripley-kit/web-container-ui-port";
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
import type { ExampleWithdrawalBusiness } from "./operation-business";
import { WithdrawalDiagnosticsStore } from "./operator-diagnostics";
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
  readonly withdrawalBusiness?: ExampleWithdrawalBusiness | undefined;
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
  const broker = new CorrelatedInputSourceBroker();
  inputSources.register(broker.createAdapter({ kind: "ui.command" }));
  const flowEngine = createFlowEngine({
    deviceLocks: locks,
    devices,
    inputSources,
    projection: new UiPortFlowProjectionAdapter(ui),
    scopedStore,
  });
  let bootstrapError: string | undefined;
  let disposeDevices: (() => Promise<void>) | undefined;
  let hostdComposition: HostdDeviceComposition | undefined;
  let healthTimer: ReturnType<typeof setInterval> | undefined;
  let healthSnapshot: HostdHealthSnapshot | undefined;
  let capabilities: Readonly<Record<string, CapabilityStatus>> = {};
  const hostd = hostdConfig(options.hostd);
  const operationAmounts = new Map<string, number>();
  const withdrawalDiagnostics =
    options.withdrawalBusiness?.diagnostics ?? new WithdrawalDiagnosticsStore();

  if (options.mode === "memory") {
    inputSources.register(broker.createAdapter({ kind: "barcodeReader.qr" }));
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
    devices,
    flowEngine,
    inputSources,
    locks,
    mode: options.mode,
    programmaticInputKinds:
      options.mode === "memory"
        ? ["ui.command", "barcodeReader.qr", "pinpad.pin"]
        : ["ui.command"],
    operationMaterial: options.withdrawalBusiness?.operationMaterial,
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
    executeBusiness: (ctx, assessment) =>
      executeWithdrawalBusiness(options.withdrawalBusiness, operationAmounts, ctx, assessment),
    mode: options.mode,
    onOperationExit: (context) => {
      operationAmounts.delete(context.operationId);
      options.withdrawalBusiness?.onOperationExit?.(context);
    },
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
      operationAmounts.set(ctx.operationId, amount);
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
    await flowEngine.dispose();
    await disposeDevices?.();
  };
  const rebootApplication = async (mode: KioskRuntimeMode): Promise<void> => {
    await disposeApplication();
    await options.onReboot?.(mode);
  };
  runtime.commands.register({
    execute: async (
      _ctx,
      input: {
        identity?: Parameters<typeof broker.submit>[0]["identity"];
        intentId?: string;
        value?: string;
        secureConfirmation?: boolean;
      },
    ) => {
      broker.submit({
        identity: input.identity ?? broker.requireActiveIdentity("customer"),
        intentId: input.intentId ?? "kiosk.input.submit",
        payload: input.secureConfirmation ? undefined : (input.value ?? ""),
      });
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
      withdrawal: withdrawalDiagnostics,
    },
    dispose: disposeApplication,
    flowEngine,
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

const createMemoryPinAdapter = (broker: CorrelatedInputSourceBroker) =>
  broker.createAdapter<SecurePinInputResult>({
    kind: "pinpad.pin",
    mapResult: (_submission, source) => ({
      encryptedPinBlock: "MEMORY-ADAPTER-PIN-BLOCK",
      kind: "securePin",
      safeSummary: {
        hasEncryptedPinBlock: true,
        sourceKind: "pinpad.pin",
      },
      source: {
        ...(source.deviceId ? { deviceId: source.deviceId } : {}),
        id: source.id,
        kind: "pinpad.pin",
      },
    }),
  });

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

const executeWithdrawalBusiness = (
  business: ExampleWithdrawalBusiness | undefined,
  amounts: ReadonlyMap<string, number>,
  context: Parameters<ExampleWithdrawalBusiness["execute"]>[0]["context"],
  assessment: CredentialAssessment,
) => {
  if (!business) {
    return Promise.resolve({
      approved: true,
      entryMethodId: assessment.credential.entryMethodId,
    });
  }
  const amount = amounts.get(context.operationId);
  if (amount === undefined) {
    throw new Error("withdrawal.amount.missing");
  }
  return business.execute({ amount, assessment, context });
};
