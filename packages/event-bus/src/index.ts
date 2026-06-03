export type EventHandler<T> = (payload: T) => Promise<void> | void;

export interface EventBusErrorContext {
  event: string;
  error: unknown;
}

export interface EventBusOptions {
  onHandlerError?: (context: EventBusErrorContext) => void;
}

export class TypedEventBus<TEvents extends object> {
  private readonly handlers = new Map<keyof TEvents, Set<EventHandler<never>>>();
  private readonly onHandlerError?: EventBusOptions["onHandlerError"];

  public constructor(options: EventBusOptions = {}) {
    this.onHandlerError = options.onHandlerError;
  }

  public subscribe<TKey extends keyof TEvents>(
    event: TKey,
    handler: EventHandler<TEvents[TKey]>,
  ): () => void {
    const handlers = this.handlers.get(event) ?? new Set<EventHandler<never>>();
    handlers.add(handler as EventHandler<never>);
    this.handlers.set(event, handlers);
    return () => handlers.delete(handler as EventHandler<never>);
  }

  public async publish<TKey extends keyof TEvents>(
    event: TKey,
    payload: TEvents[TKey],
  ): Promise<void> {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        await handler(payload as never);
      } catch (error) {
        this.onHandlerError?.({ event: String(event), error });
        throw error;
      }
    }
  }

  public async publishBestEffort<TKey extends keyof TEvents>(
    event: TKey,
    payload: TEvents[TKey],
  ): Promise<void> {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        await handler(payload as never);
      } catch (error) {
        this.onHandlerError?.({ event: String(event), error });
      }
    }
  }
}
