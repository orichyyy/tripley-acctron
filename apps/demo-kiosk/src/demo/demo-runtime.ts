import { atmBasicFlow, atmBasicSteps } from "@tripley-acctron/atm-basic";
import {
  DefaultVoiceGuideService,
  HeadlessAudioPlayer,
  NoopTtsService,
  StaticAudioAssetResolver,
} from "@tripley-acctron/accessibility";
import type {
  HostGateway,
  HostRequest,
  HostResponse,
  HostSendOptions,
  KioskCommands,
  KioskQueries,
  TransactionLifecycleStatus,
  TypedCommandBus,
  TypedQueryBus,
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
import { createKioskApp, registerTransactionLifecycle } from "@tripley-acctron/runtime-core";
import { InMemoryTransactionDataStore, createFakeDevices } from "@tripley-acctron/testing";
import { HeadlessWindowManager } from "@tripley-acctron/window-coordinator";
import { resultStateFor, type DemoScreens, type HostScenario } from "./screens";

export interface DemoKioskRuntime {
  store: UiRuntimeStore;
  commands: TypedCommandBus<KioskCommands>;
  queries: TypedQueryBus<KioskQueries>;
  start(scenario: HostScenario): Promise<TransactionLifecycleStatus>;
  reset(scenario: HostScenario): Promise<TransactionLifecycleStatus>;
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
  registerTransactionLifecycle({
    commands: app.commands,
    queries: app.queries,
    flow,
    logger,
    transaction,
    ui,
    hooks: {
      beforeStart(request) {
        transaction.clear();
        host.setScenario(scenarioFromMetadata(request.metadata));
        return ui.show("demo.processing", {});
      },
      afterComplete(status) {
        const endName = status.result?.endName ?? "Failed";
        return ui.show("demo.result", resultStateFor(endName, transaction.get("accountNo")));
      },
      afterFailed(status) {
        return ui.show("demo.result", {
          endName: "Failed",
          tone: "danger",
          title: "Transaction failed",
          message: status.errorMessage ?? "The transaction could not be completed.",
        });
      },
      afterCancelled(_status) {
        return ui.show("demo.result", resultStateFor("Cancelled", transaction.get("accountNo")));
      },
      afterReset(request) {
        return ui.show("demo.welcome", { scenario: scenarioFromMetadata(request.metadata) });
      },
    },
  });

  return {
    store,
    commands: app.commands,
    queries: app.queries,
    async reset(scenario) {
      return await app.commands.execute("transaction.reset", { metadata: { scenario } });
    },
    async start(scenario) {
      return await app.commands.execute("transaction.start", {
        flowId: "atm-basic",
        metadata: { scenario },
      });
    },
    emitAction(screen, action) {
      store.emitAction(String(screen), action);
    },
  };
}

function scenarioFromMetadata(metadata: Record<string, unknown> | undefined): HostScenario {
  const scenario = metadata?.scenario;
  return scenario === "declined" || scenario === "failed" ? scenario : "approved";
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
