import { atmBasicFlow, atmBasicSteps } from "@tripley-acctron/atm-basic";
import {
  DefaultVoiceGuideService,
  HeadlessAudioPlayer,
  NoopTtsService,
  StaticAudioAssetResolver,
} from "@tripley-acctron/accessibility";
import type {
  FlowRunResult,
  HostGateway,
  HostRequest,
  HostResponse,
  HostSendOptions,
} from "@tripley-acctron/contracts";
import {
  DefaultRecoveryManager,
  DefaultTimeoutService,
  FlowEngine,
  InMemoryTransactionResourceRegistry,
  StepRegistry,
  SystemClock,
} from "@tripley-acctron/flow-engine";
import {
  DefaultInteractionAuditService,
  DefaultRedactionService,
  InMemoryElectronicJournal,
  InMemoryLogger,
} from "@tripley-acctron/observability";
import { ReactUiAdapter, UiRuntimeStore } from "@tripley-acctron/react-ui";
import { createKioskApp } from "@tripley-acctron/runtime-core";
import { InMemoryTransactionDataStore, createFakeDevices } from "@tripley-acctron/testing";
import { HeadlessWindowManager } from "@tripley-acctron/window-coordinator";
import { resultStateFor, type DemoScreens, type HostScenario } from "./screens";

export interface DemoKioskRuntime {
  store: UiRuntimeStore;
  start(scenario: HostScenario): Promise<FlowRunResult>;
  reset(scenario: HostScenario): Promise<void>;
  emitAction<K extends keyof DemoScreens>(screen: K, action: DemoScreens[K]["actions"]): void;
}

export function createDemoKioskRuntime(): DemoKioskRuntime {
  const store = new UiRuntimeStore();
  const ui = new ReactUiAdapter<DemoScreens>(store);
  const logger = new InMemoryLogger();
  const journal = new InMemoryElectronicJournal();
  const redaction = new DefaultRedactionService();
  const audit = new DefaultInteractionAuditService({ logger, journal, redaction });
  const devices = createFakeDevices();
  const clock = new SystemClock();
  const timeoutService = new DefaultTimeoutService({ clock, ui });
  const resources = new InMemoryTransactionResourceRegistry(logger);
  const transaction = new InMemoryTransactionDataStore();
  const host = new ScenarioHostGateway();
  const recovery = new DefaultRecoveryManager({ resources, logger, devices, ui });
  const tts = new NoopTtsService();
  const voiceGuide = new DefaultVoiceGuideService({
    resolver: new StaticAudioAssetResolver(),
    player: new HeadlessAudioPlayer(),
  });
  const windows = new HeadlessWindowManager();
  const app = createKioskApp({ role: "mainCustomerScreen", logger });

  const flow = new FlowEngine({
    flows: [atmBasicFlow],
    steps: StepRegistry.fromRecord(atmBasicSteps),
    ui,
    logger,
    resources,
    recovery,
    context: {
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
      host,
    },
  });

  return {
    store,
    async reset(scenario) {
      transaction.clear();
      await ui.closeDialog();
      await ui.show("demo.welcome", { scenario });
    },
    async start(scenario) {
      transaction.clear();
      host.setScenario(scenario);
      await ui.show("demo.processing", {});
      const result = await flow.run("atm-basic");
      await ui.show("demo.result", resultStateFor(result.endName, transaction.get("accountNo")));
      return result;
    },
    emitAction(screen, action) {
      store.emitAction(String(screen), action);
    },
  };
}

class ScenarioHostGateway implements HostGateway {
  private scenario: HostScenario = "approved";

  public setScenario(scenario: HostScenario): void {
    this.scenario = scenario;
  }

  public send<TReq = unknown, TRes = unknown>(
    messageType: string,
    body: TReq,
    options?: HostSendOptions,
  ): Promise<HostResponse<TRes>> {
    return this.request({ messageType, body }, options);
  }

  public async request<TReq = unknown, TRes = unknown>(
    _request: HostRequest<TReq>,
    options?: HostSendOptions,
  ): Promise<HostResponse<TRes>> {
    if (options?.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    if (this.scenario === "failed") {
      throw new Error("Demo host failure.");
    }
    return {
      requestId: `demo-host-${Date.now()}`,
      status: "approved",
      body: { approved: this.scenario === "approved" } as TRes,
    };
  }
}
