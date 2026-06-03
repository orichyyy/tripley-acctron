import type { LifecycleRegistry } from "@tripley-acctron/contracts";

export class DefaultLifecycleRegistry implements LifecycleRegistry {
  private readonly startCallbacks: Array<() => void | Promise<void>> = [];
  private readonly stopCallbacks: Array<() => void | Promise<void>> = [];

  public onStart(callback: () => void | Promise<void>): void {
    this.startCallbacks.push(callback);
  }

  public onStop(callback: () => void | Promise<void>): void {
    this.stopCallbacks.push(callback);
  }

  public async start(): Promise<void> {
    for (const callback of this.startCallbacks) {
      await callback();
    }
  }

  public async stop(): Promise<void> {
    for (const callback of [...this.stopCallbacks].reverse()) {
      await callback();
    }
  }
}
