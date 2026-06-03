import {
  KioskError,
  type CommandRequest,
  type CommandResponse,
  type Disposable,
  type QueryRequest,
  type QueryResponse,
  type TypedCommandBus,
  type TypedQueryBus,
} from "@tripley-acctron/contracts";

type AnyHandler = (request: never) => unknown | Promise<unknown>;

export class InMemoryCommandBus<Commands> implements TypedCommandBus<Commands> {
  private readonly handlers = new Map<keyof Commands, AnyHandler>();

  public async execute<K extends keyof Commands>(
    name: K,
    request: CommandRequest<Commands[K]>,
  ): Promise<CommandResponse<Commands[K]>> {
    const handler = this.handlers.get(name);
    if (!handler) {
      throw new KioskError(
        "bus.handlerMissing",
        `No command handler registered for ${String(name)}.`,
      );
    }
    return (await handler(request as never)) as CommandResponse<Commands[K]>;
  }

  public handle<K extends keyof Commands>(
    name: K,
    handler: (
      request: CommandRequest<Commands[K]>,
    ) => CommandResponse<Commands[K]> | Promise<CommandResponse<Commands[K]>>,
  ): Disposable {
    if (this.handlers.has(name)) {
      throw new KioskError(
        "bus.handlerDuplicate",
        `Command handler already registered for ${String(name)}.`,
      );
    }
    this.handlers.set(name, handler as AnyHandler);
    return {
      dispose: () => {
        this.handlers.delete(name);
      },
    };
  }
}

export class InMemoryQueryBus<Queries> implements TypedQueryBus<Queries> {
  private readonly handlers = new Map<keyof Queries, AnyHandler>();

  public async query<K extends keyof Queries>(
    name: K,
    request: QueryRequest<Queries[K]>,
  ): Promise<QueryResponse<Queries[K]>> {
    const handler = this.handlers.get(name);
    if (!handler) {
      throw new KioskError(
        "bus.handlerMissing",
        `No query handler registered for ${String(name)}.`,
      );
    }
    return (await handler(request as never)) as QueryResponse<Queries[K]>;
  }

  public handle<K extends keyof Queries>(
    name: K,
    handler: (
      request: QueryRequest<Queries[K]>,
    ) => QueryResponse<Queries[K]> | Promise<QueryResponse<Queries[K]>>,
  ): Disposable {
    if (this.handlers.has(name)) {
      throw new KioskError(
        "bus.handlerDuplicate",
        `Query handler already registered for ${String(name)}.`,
      );
    }
    this.handlers.set(name, handler as AnyHandler);
    return {
      dispose: () => {
        this.handlers.delete(name);
      },
    };
  }
}
