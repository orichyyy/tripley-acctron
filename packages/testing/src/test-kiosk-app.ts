import type {
  Clock,
  DeviceManager,
  FlowDefinition,
  KioskPlugin,
  Logger,
  RecoveryManager,
  StepHandler,
  TimeoutService,
  TransactionResourceRegistry,
} from "@tripley-acctron/contracts";
import {
  DefaultRecoveryManager,
  DefaultTimeoutService,
  FlowEngine,
  InMemoryTransactionResourceRegistry,
  StepRegistry,
} from "@tripley-acctron/flow-engine";
import { InMemoryLogger } from "@tripley-acctron/observability";
import { createKioskApp } from "@tripley-acctron/runtime-core";
import { createFakeDevices } from "./fake-devices";
import { HeadlessUiAdapter } from "./headless-ui-adapter";
import { VirtualClock } from "./virtual-clock";

export interface TestKioskAppOptions {
  flows?: FlowDefinition[];
  steps?: Record<string, StepHandler>;
  plugins?: KioskPlugin[];
  logger?: Logger;
  devices?: DeviceManager;
  clock?: Clock;
  timeoutService?: TimeoutService;
  resources?: TransactionResourceRegistry;
  recovery?: RecoveryManager;
}

export function createTestKioskApp(options: TestKioskAppOptions = {}) {
  const logger = options.logger ?? new InMemoryLogger();
  const ui = new HeadlessUiAdapter();
  const devices = options.devices ?? createFakeDevices();
  const clock = options.clock ?? new VirtualClock();
  const timeoutService = options.timeoutService ?? new DefaultTimeoutService({ clock, ui });
  const resources = options.resources ?? new InMemoryTransactionResourceRegistry(logger);
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
  const flow = new FlowEngine({
    flows: options.flows ?? [],
    steps: StepRegistry.fromRecord(options.steps ?? {}),
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
      logger,
    },
  });
  return { app, flow, ui, devices, clock, timeoutService, resources, recovery, logger };
}
