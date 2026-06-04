import type {
  Clock,
  DeviceManager,
  ElectronicJournal,
  FlowDefinition,
  HostGateway,
  InteractionAuditService,
  KioskPlugin,
  Logger,
  RedactionService,
  RecoveryManager,
  StepHandler,
  TransactionDataStore,
  TtsService,
  TimeoutService,
  TransactionResourceRegistry,
  VoiceGuideService,
  WindowManagerPort,
} from "@tripley-acctron/contracts";
import {
  DefaultVoiceGuideService,
  HeadlessAudioPlayer,
  NoopTtsService,
  StaticAudioAssetResolver,
} from "@tripley-acctron/accessibility";
import {
  DefaultRecoveryManager,
  DefaultTimeoutService,
  FlowEngine,
  InMemoryTransactionResourceRegistry,
  StepRegistry,
} from "@tripley-acctron/flow-engine";
import {
  DefaultInteractionAuditService,
  DefaultRedactionService,
  InMemoryElectronicJournal,
  InMemoryLogger,
} from "@tripley-acctron/observability";
import { createKioskApp } from "@tripley-acctron/runtime-core";
import { HeadlessWindowManager } from "@tripley-acctron/window-coordinator";
import { createFakeDevices } from "./fake-devices";
import { HeadlessUiAdapter } from "./headless-ui-adapter";
import { InMemoryTransactionDataStore } from "./in-memory-transaction";
import { VirtualClock } from "./virtual-clock";

export interface TestKioskAppOptions {
  flows?: FlowDefinition[];
  steps?: Record<string, StepHandler>;
  plugins?: KioskPlugin[];
  logger?: Logger;
  journal?: ElectronicJournal;
  redaction?: RedactionService;
  audit?: InteractionAuditService;
  devices?: DeviceManager;
  host?: HostGateway;
  clock?: Clock;
  timeoutService?: TimeoutService;
  resources?: TransactionResourceRegistry;
  recovery?: RecoveryManager;
  transaction?: TransactionDataStore;
  tts?: TtsService;
  voiceGuide?: VoiceGuideService;
  windows?: WindowManagerPort;
}

export function createTestKioskApp(options: TestKioskAppOptions = {}) {
  const logger = options.logger ?? new InMemoryLogger();
  const journal = options.journal ?? new InMemoryElectronicJournal();
  const redaction = options.redaction ?? new DefaultRedactionService();
  const audit =
    options.audit ??
    new DefaultInteractionAuditService({
      logger,
      journal,
      redaction,
    });
  const ui = new HeadlessUiAdapter();
  const devices = options.devices ?? createFakeDevices();
  const clock = options.clock ?? new VirtualClock();
  const timeoutService = options.timeoutService ?? new DefaultTimeoutService({ clock, ui });
  const resources = options.resources ?? new InMemoryTransactionResourceRegistry(logger);
  const transaction = options.transaction ?? new InMemoryTransactionDataStore();
  const tts = options.tts ?? new NoopTtsService();
  const voiceGuide =
    options.voiceGuide ??
    new DefaultVoiceGuideService({
      resolver: new StaticAudioAssetResolver(),
      player: new HeadlessAudioPlayer(),
    });
  const windows = options.windows ?? new HeadlessWindowManager();
  const recovery =
    options.recovery ??
    new DefaultRecoveryManager({
      resources,
      logger,
      devices,
      ui,
    });
  const appOptions = {
    role: "headlessTest",
    logger,
  } as const;
  const app = createKioskApp(
    options.plugins ? { ...appOptions, plugins: options.plugins } : appOptions,
  );
  const context = {
    events: app.events,
    commands: app.commands,
    queries: app.queries,
    devices,
    timeoutService,
    resources,
    recovery,
    transaction,
    journal,
    redaction,
    audit,
    tts,
    voiceGuide,
    windows,
    logger,
  };
  const flow = new FlowEngine({
    flows: options.flows ?? [],
    steps: StepRegistry.fromRecord(options.steps ?? {}),
    ui,
    logger,
    resources,
    recovery,
    context: options.host ? { ...context, host: options.host } : context,
  });
  return {
    app,
    flow,
    ui,
    devices,
    clock,
    timeoutService,
    resources,
    recovery,
    transaction,
    journal,
    redaction,
    audit,
    tts,
    voiceGuide,
    windows,
    logger,
  };
}
