export type ServiceToken<T> = symbol & { readonly __service?: T };

export function createServiceToken<T>(description: string): ServiceToken<T> {
  return Symbol(description);
}

export class ServiceRegistry {
  private readonly services = new Map<symbol, unknown>();

  public register<T>(token: ServiceToken<T>, service: T): void {
    if (this.services.has(token)) {
      throw new Error(`Service already registered: ${token.description ?? "unknown"}`);
    }
    this.services.set(token, service);
  }

  public resolve<T>(token: ServiceToken<T>): T {
    if (!this.services.has(token)) {
      throw new Error(`Service not registered: ${token.description ?? "unknown"}`);
    }
    return this.services.get(token) as T;
  }
}

export interface PluginContext {
  services: ServiceRegistry;
}

export interface Plugin {
  name: string;
  setup?(context: PluginContext): Promise<void> | void;
  start?(context: PluginContext): Promise<void> | void;
  stop?(context: PluginContext): Promise<void> | void;
}

export class PluginManager {
  private readonly context: PluginContext;
  private readonly plugins: readonly Plugin[];
  private started: Plugin[] = [];

  public constructor(plugins: readonly Plugin[], services = new ServiceRegistry()) {
    const names = new Set<string>();
    for (const plugin of plugins) {
      if (names.has(plugin.name)) {
        throw new Error(`Duplicate plugin: ${plugin.name}`);
      }
      names.add(plugin.name);
    }
    this.plugins = plugins;
    this.context = { services };
  }

  public get services(): ServiceRegistry {
    return this.context.services;
  }

  public async setup(): Promise<void> {
    for (const plugin of this.plugins) {
      await plugin.setup?.(this.context);
    }
  }

  public async start(): Promise<void> {
    for (const plugin of this.plugins) {
      await plugin.start?.(this.context);
      this.started.push(plugin);
    }
  }

  public async stop(): Promise<void> {
    const failures: unknown[] = [];
    for (const plugin of this.started.reverse()) {
      try {
        await plugin.stop?.(this.context);
      } catch (error) {
        failures.push(error);
      }
    }
    this.started = [];
    if (failures.length > 0) {
      throw new AggregateError(failures, "One or more plugins failed to stop.");
    }
  }
}
