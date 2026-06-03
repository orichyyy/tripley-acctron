import type { FlowDefinition, KioskPlugin, Logger, StepHandler } from "@tripley-acctron/contracts";
import { FlowEngine, StepRegistry } from "@tripley-acctron/flow-engine";
import { InMemoryLogger } from "@tripley-acctron/observability";
import { createKioskApp } from "@tripley-acctron/runtime-core";
import { HeadlessUiAdapter } from "./headless-ui-adapter";

export interface TestKioskAppOptions {
  flows?: FlowDefinition[];
  steps?: Record<string, StepHandler>;
  plugins?: KioskPlugin[];
  logger?: Logger;
}

export function createTestKioskApp(options: TestKioskAppOptions = {}) {
  const logger = options.logger ?? new InMemoryLogger();
  const ui = new HeadlessUiAdapter();
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
    context: {
      events: app.events,
      commands: app.commands,
      queries: app.queries,
      logger,
    },
  });
  return { app, flow, ui, logger };
}
