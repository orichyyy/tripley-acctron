import type {
  KioskCommands,
  KioskEvents,
  KioskPlugin,
  KioskQueries,
  Logger,
  RuntimeRole,
  ServiceRegistry,
  TypedCommandBus,
  TypedEventBus,
  TypedQueryBus,
} from "@tripley-acctron/contracts";
import { InMemoryCommandBus, InMemoryEventBus, InMemoryQueryBus } from "@tripley-acctron/event-bus";
import { InMemoryLogger } from "@tripley-acctron/observability";
import {
  DefaultLifecycleRegistry,
  DefaultServiceRegistry,
  PluginRuntime,
} from "@tripley-acctron/plugin-system";

export interface KioskAppOptions {
  role: RuntimeRole;
  plugins?: KioskPlugin[];
  logger?: Logger;
}

export interface KioskApp {
  start(): Promise<void>;
  stop(): Promise<void>;
  events: TypedEventBus<KioskEvents>;
  commands: TypedCommandBus<KioskCommands>;
  queries: TypedQueryBus<KioskQueries>;
  services: ServiceRegistry;
}

export function createKioskApp(options: KioskAppOptions): KioskApp {
  const events = new InMemoryEventBus<KioskEvents>();
  const commands = new InMemoryCommandBus<KioskCommands>();
  const queries = new InMemoryQueryBus<KioskQueries>();
  const services = new DefaultServiceRegistry();
  const lifecycle = new DefaultLifecycleRegistry();
  const logger = options.logger ?? new InMemoryLogger();
  const plugins = new PluginRuntime(options.plugins ?? []);
  let started = false;

  return {
    events,
    commands,
    queries,
    services,
    async start() {
      if (started) {
        return;
      }
      await plugins.setup({
        role: options.role,
        events,
        commands,
        queries,
        services,
        lifecycle,
        logger,
      });
      await lifecycle.start();
      started = true;
    },
    async stop() {
      if (!started) {
        return;
      }
      await lifecycle.stop();
      started = false;
    },
  };
}
