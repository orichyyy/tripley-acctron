import type { HostSessionSubscription, HostSessionSupervisorEvent } from "./contracts";

export class HostSessionLifecycleEmitter {
  private readonly handlers = new Set<(event: HostSessionSupervisorEvent) => void>();

  public subscribe(handler: (event: HostSessionSupervisorEvent) => void): HostSessionSubscription {
    this.handlers.add(handler);
    return {
      unsubscribe: () => {
        this.handlers.delete(handler);
      },
    };
  }

  public emit(event: HostSessionSupervisorEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // Observers cannot change host session behavior.
      }
    }
  }

  public clear(): void {
    this.handlers.clear();
  }
}
