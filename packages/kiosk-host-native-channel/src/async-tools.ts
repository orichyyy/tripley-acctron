export class HostChannelTimeoutError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "HostChannelTimeoutError";
  }
}

export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve();

  public run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new HostChannelTimeoutError(code)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

export const remainingTimeoutMs = (deadline: number, limitMs: number): number =>
  Math.max(1, Math.min(limitMs, deadline - Date.now()));

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

export const deferred = <T>(): Deferred<T> => {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  let settled = false;
  return {
    promise,
    resolve: (value) => {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    },
  };
};
