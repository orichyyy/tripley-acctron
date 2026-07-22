import type { NativeEventSubscription } from "./contracts";
import type {
  PersistentHostSessionLifecycleEvent,
  PersistentHostSessionState,
} from "./persistent-contracts";

export type PersistentLifecycleEventInput = Pick<PersistentHostSessionLifecycleEvent, "type"> &
  Partial<Pick<PersistentHostSessionLifecycleEvent, "delayMs" | "errorCode" | "inboundType">>;

export class PersistentHostLifecycleEmitter {
  private readonly handlers = new Set<(event: PersistentHostSessionLifecycleEvent) => void>();

  public subscribe(
    handler: (event: PersistentHostSessionLifecycleEvent) => void,
  ): NativeEventSubscription {
    this.handlers.add(handler);
    return { unsubscribe: () => this.handlers.delete(handler) };
  }

  public emit(
    state: PersistentHostSessionState,
    generation: number,
    event: PersistentLifecycleEventInput,
  ): void {
    const safeEvent: PersistentHostSessionLifecycleEvent = {
      at: Date.now(),
      generation,
      state,
      ...event,
    };
    for (const handler of this.handlers) {
      try {
        handler(safeEvent);
      } catch {
        // Lifecycle observers cannot affect transport state.
      }
    }
  }

  public clear(): void {
    this.handlers.clear();
  }
}
