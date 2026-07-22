import type {
  HostWireExchangeRequest,
  HostWireExchangeResult,
} from "@tripley-kit/web-container-kiosk-host-integration";
import type {
  HostSessionScheduledTask,
  HostSessionScheduler,
  HostSessionTransportLifecycleEvent,
  HostSessionTransportPort,
} from "./contracts";

interface ScheduledEntry {
  readonly at: number;
  readonly callback: () => void;
  cancelled: boolean;
}

export class TestScheduler implements HostSessionScheduler {
  private current = 0;
  private readonly entries: ScheduledEntry[] = [];

  public now(): number {
    return this.current;
  }

  public schedule(delayMs: number, callback: () => void): HostSessionScheduledTask {
    const entry: ScheduledEntry = { at: this.current + delayMs, callback, cancelled: false };
    this.entries.push(entry);
    return {
      cancel: () => {
        entry.cancelled = true;
      },
    };
  }

  public async advanceBy(milliseconds: number): Promise<void> {
    this.current += milliseconds;
    let entry = this.nextDue();
    while (entry) {
      entry.cancelled = true;
      entry.callback();
      await flushPromises();
      entry = this.nextDue();
    }
  }

  private nextDue(): ScheduledEntry | undefined {
    return this.entries
      .filter((entry) => !entry.cancelled && entry.at <= this.current)
      .sort((left, right) => left.at - right.at)[0];
  }
}

export class TestHostSessionTransport implements HostSessionTransportPort {
  public readonly id = "transport.primary";
  public generation = 0;
  public state = "idle";
  public readonly requests: HostWireExchangeRequest[] = [];
  public exchangeResult: HostWireExchangeResult = {
    payload: Uint8Array.of(0x4f, 0x4b),
    responseId: "response-1",
    status: "response",
  };
  private readonly handlers = new Set<(event: HostSessionTransportLifecycleEvent) => void>();

  public async start(): Promise<void> {
    this.connect();
  }

  public exchange(request: HostWireExchangeRequest): Promise<HostWireExchangeResult> {
    this.requests.push(request);
    return Promise.resolve(this.exchangeResult);
  }

  public onLifecycle(handler: (event: HostSessionTransportLifecycleEvent) => void) {
    this.handlers.add(handler);
    return {
      unsubscribe: () => {
        this.handlers.delete(handler);
      },
    };
  }

  public async dispose(): Promise<void> {
    this.state = "disposed";
    this.emit("disposed");
  }

  public disconnect(errorCode = "host.test.disconnected"): void {
    this.state = "idle";
    this.emit("disconnected", errorCode);
  }

  public connect(): void {
    this.state = "connected";
    this.generation += 1;
    this.emit("connected");
  }

  private emit(type: HostSessionTransportLifecycleEvent["type"], errorCode?: string): void {
    const event: HostSessionTransportLifecycleEvent = {
      at: 0,
      errorCode,
      generation: this.generation,
      state: this.state,
      type,
    };
    for (const handler of this.handlers) handler(event);
  }
}

export const flushPromises = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

export const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
};

export const testPolicy = {
  establishRetry: { initialDelayMs: 10, maxDelayMs: 100, multiplier: 2 },
  establishTimeoutMs: 50,
  heartbeat: { failureThreshold: 2, intervalMs: 20, timeoutMs: 10 },
};
