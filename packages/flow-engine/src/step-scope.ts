import {
  ScopeDisposedError,
  type KioskEvents,
  type StepScope,
  type TypedEventBus,
} from "@tripley-acctron/contracts";

export class StepScopeImpl implements StepScope {
  private readonly abortController = new AbortController();
  private readonly cleanups: Array<() => void | Promise<void>> = [];
  private isDisposed = false;

  public constructor(private readonly events: TypedEventBus<KioskEvents>) {}

  public get signal(): AbortSignal {
    return this.abortController.signal;
  }

  public get disposed(): boolean {
    return this.isDisposed;
  }

  public onDispose(cleanup: () => void | Promise<void>): void {
    if (this.isDisposed) {
      throw new ScopeDisposedError();
    }
    this.cleanups.push(cleanup);
  }

  public async dispose(): Promise<void> {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    this.abortController.abort(new ScopeDisposedError());

    for (const cleanup of [...this.cleanups].reverse()) {
      await cleanup();
    }
    this.cleanups.length = 0;
  }

  public async guard<T>(task: Promise<T>): Promise<T> {
    if (this.isDisposed) {
      throw new ScopeDisposedError();
    }
    const result = await task;
    if (this.isDisposed) {
      throw new ScopeDisposedError();
    }
    return result;
  }

  public waitEvent<K extends keyof KioskEvents>(
    name: K,
    predicate?: (payload: KioskEvents[K]) => boolean,
  ): Promise<KioskEvents[K]> {
    const options = predicate ? { signal: this.signal, predicate } : { signal: this.signal };
    return this.events.wait(name, options);
  }

  public race<T>(tasks: Array<Promise<T>>): Promise<T> {
    return this.guard(Promise.race(tasks));
  }
}
