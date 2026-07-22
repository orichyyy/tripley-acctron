import type { HostSessionSnapshot, HostSessionSupervisorPort } from "./contracts";

export type HostSessionStartupMode = "required" | "degraded";

interface HostSessionRegistration {
  readonly supervisor: HostSessionSupervisorPort;
  readonly startup: HostSessionStartupMode;
}

export class HostSessionSupervisorRegistry {
  private readonly registrations = new Map<string, HostSessionRegistration>();
  private frozen = false;

  public register(
    supervisor: HostSessionSupervisorPort,
    options: { readonly startup?: HostSessionStartupMode } = {},
  ): this {
    if (this.frozen) throw new Error("HostSessionSupervisorRegistry is frozen");
    if (!supervisor.id || this.registrations.has(supervisor.id)) {
      throw new Error(`Host session supervisor is already registered: ${supervisor.id}`);
    }
    this.registrations.set(supervisor.id, {
      startup: options.startup ?? "degraded",
      supervisor,
    });
    return this;
  }

  public freeze(): this {
    this.frozen = true;
    return this;
  }

  public require(id: string): HostSessionSupervisorPort {
    const registration = this.registrations.get(id);
    if (!registration) throw new Error(`Host session supervisor is not registered: ${id}`);
    return registration.supervisor;
  }

  public entries(): readonly HostSessionRegistration[] {
    return [...this.registrations.values()];
  }

  public snapshots(): readonly HostSessionSnapshot[] {
    return this.entries().map(({ supervisor }) => supervisor.snapshot);
  }
}

export class HostSessionRuntime {
  private started: HostSessionSupervisorPort[] = [];

  public constructor(private readonly registry: HostSessionSupervisorRegistry) {
    registry.freeze();
  }

  public async start(): Promise<void> {
    for (const registration of this.registry.entries()) {
      await registration.supervisor.start();
      this.started.push(registration.supervisor);
      if (registration.startup === "required" && !registration.supervisor.snapshot.available) {
        await this.dispose();
        throw new Error(`host.session.required-not-ready:${registration.supervisor.id}`);
      }
    }
  }

  public async dispose(): Promise<void> {
    const active = this.started.reverse();
    this.started = [];
    await Promise.all(active.map((supervisor) => supervisor.dispose()));
  }
}
