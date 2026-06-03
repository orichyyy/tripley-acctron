import type {
  Disposable,
  EventHandler,
  SubscribeOptions,
  TypedEventBus,
  WaitEventOptions,
} from "@tripley-acctron/contracts";

export class InMemoryEventBus<Events> implements TypedEventBus<Events> {
  private readonly handlers = new Map<keyof Events, Set<EventHandler<Events[keyof Events]>>>();

  public async publish<K extends keyof Events>(name: K, payload: Events[K]): Promise<void> {
    const handlers = [...(this.handlers.get(name) ?? [])] as Array<EventHandler<Events[K]>>;
    for (const handler of handlers) {
      await handler(payload);
    }
  }

  public subscribe<K extends keyof Events>(
    name: K,
    handler: EventHandler<Events[K]>,
    options: SubscribeOptions = {},
  ): Disposable {
    let disposed = false;
    const handlers = this.handlers.get(name) ?? new Set<EventHandler<Events[keyof Events]>>();
    handlers.add(handler as EventHandler<Events[keyof Events]>);
    this.handlers.set(name, handlers);

    const disposable = {
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        handlers.delete(handler as EventHandler<Events[keyof Events]>);
      },
    };

    options.signal?.addEventListener("abort", disposable.dispose, { once: true });
    return disposable;
  }

  public wait<K extends keyof Events>(
    name: K,
    options: WaitEventOptions<Events[K]> = {},
  ): Promise<Events[K]> {
    if (options.signal?.aborted) {
      return Promise.reject(options.signal.reason);
    }

    return new Promise((resolve, reject) => {
      const subscription = this.subscribe(
        name,
        (payload) => {
          if (options.predicate && !options.predicate(payload)) {
            return;
          }
          subscription.dispose();
          resolve(payload);
        },
        options,
      );

      options.signal?.addEventListener(
        "abort",
        () => {
          subscription.dispose();
          reject(options.signal?.reason ?? new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }
}
