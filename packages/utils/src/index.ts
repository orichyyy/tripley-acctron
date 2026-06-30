import type { Metadata } from "@tripley/web-container-types";

export interface Disposable {
  dispose(): void | Promise<void>;
}

export interface Subscription extends Disposable {
  readonly closed: boolean;
  unsubscribe(): void | Promise<void>;
}

export class BasicSubscription implements Subscription {
  private readonly cleanup: () => void | Promise<void>;
  private isClosed = false;

  public constructor(cleanup: () => void | Promise<void>) {
    this.cleanup = cleanup;
  }

  public get closed(): boolean {
    return this.isClosed;
  }

  public async dispose(): Promise<void> {
    await this.unsubscribe();
  }

  public async unsubscribe(): Promise<void> {
    if (this.isClosed) {
      return;
    }

    this.isClosed = true;
    await this.cleanup();
  }
}

export class CompositeDisposable implements Disposable {
  private readonly disposables = new Set<Disposable>();
  private isDisposed = false;

  public add<TDisposable extends Disposable>(disposable: TDisposable): TDisposable {
    if (this.isDisposed) {
      throw new Error("Cannot add a disposable after CompositeDisposable has been disposed.");
    }

    this.disposables.add(disposable);
    return disposable;
  }

  public async dispose(): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    this.isDisposed = true;
    const pending = [...this.disposables].map((disposable) => disposable.dispose());
    this.disposables.clear();
    await Promise.all(pending);
  }
}

export interface TraceContext {
  readonly baggage?: Metadata | undefined;
  readonly parentSpanId?: string;
  readonly spanId: string;
  readonly traceId: string;
}

export interface Clock {
  now(): Date;
  nowEpochMs(): number;
}

export const systemClock: Clock = {
  now: () => new Date(),
  nowEpochMs: () => Date.now(),
};

export interface IdGenerator {
  nextId(prefix?: string): string;
}

export class CryptoIdGenerator implements IdGenerator {
  public nextId(prefix = "id"): string {
    const randomId = crypto.randomUUID();
    return `${prefix}_${randomId}`;
  }
}

export const createTraceContext = (idGenerator: IdGenerator, baggage?: Metadata): TraceContext => ({
  baggage,
  spanId: idGenerator.nextId("span"),
  traceId: idGenerator.nextId("trace"),
});
