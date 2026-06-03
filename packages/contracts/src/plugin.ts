import type {
  KioskCommands,
  KioskEvents,
  KioskQueries,
  TypedCommandBus,
  TypedEventBus,
  TypedQueryBus,
} from "./bus";
import type { Logger } from "./observability";

export type RuntimeRole =
  | "mainCustomerScreen"
  | "supervisorScreen"
  | "operatorScreen"
  | "diagnosticScreen"
  | "headlessTest";

export interface ServiceToken<T> {
  readonly id: string;
  readonly description?: string;
  readonly type?: T;
}

export interface ProvideOptions {
  override?: boolean;
  multi?: boolean;
}

export interface ServiceRegistry {
  provide<T>(token: ServiceToken<T>, value: T, options?: ProvideOptions): void;
  get<T>(token: ServiceToken<T>): T;
  tryGet<T>(token: ServiceToken<T>): T | undefined;
  has<T>(token: ServiceToken<T>): boolean;
}

export interface LifecycleRegistry {
  onStart(callback: () => void | Promise<void>): void;
  onStop(callback: () => void | Promise<void>): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface PluginContext {
  role: RuntimeRole;
  events: TypedEventBus<KioskEvents>;
  commands: TypedCommandBus<KioskCommands>;
  queries: TypedQueryBus<KioskQueries>;
  services: ServiceRegistry;
  lifecycle: LifecycleRegistry;
  logger: Logger;
}

export interface KioskPlugin {
  readonly id: string;
  readonly version: string;
  readonly dependsOn?: string[];
  setup(ctx: PluginContext): void | Promise<void>;
}
