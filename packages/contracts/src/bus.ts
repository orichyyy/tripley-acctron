export interface Disposable {
  dispose(): void | Promise<void>;
}

// biome-ignore lint/suspicious/noEmptyInterface: Plugins augment this public event map.
export interface KioskEvents {}
// biome-ignore lint/suspicious/noEmptyInterface: Plugins augment this public command map.
export interface KioskCommands {}
// biome-ignore lint/suspicious/noEmptyInterface: Plugins augment this public query map.
export interface KioskQueries {}

export type EventHandler<T> = (payload: T) => void | Promise<void>;

export interface SubscribeOptions {
  signal?: AbortSignal;
}

export interface WaitEventOptions<T> extends SubscribeOptions {
  predicate?: (payload: T) => boolean;
}

export interface CommandDef<Request, Response> {
  request: Request;
  response: Response;
}

export interface QueryDef<Request, Response> {
  request: Request;
  response: Response;
}

export type CommandRequest<T> = T extends CommandDef<infer Request, unknown> ? Request : never;
export type CommandResponse<T> = T extends CommandDef<unknown, infer Response> ? Response : never;
export type QueryRequest<T> = T extends QueryDef<infer Request, unknown> ? Request : never;
export type QueryResponse<T> = T extends QueryDef<unknown, infer Response> ? Response : never;

export interface TypedEventBus<Events> {
  publish<K extends keyof Events>(name: K, payload: Events[K]): Promise<void>;
  subscribe<K extends keyof Events>(
    name: K,
    handler: EventHandler<Events[K]>,
    options?: SubscribeOptions,
  ): Disposable;
  wait<K extends keyof Events>(name: K, options?: WaitEventOptions<Events[K]>): Promise<Events[K]>;
}

export interface TypedCommandBus<Commands> {
  execute<K extends keyof Commands>(
    name: K,
    request: CommandRequest<Commands[K]>,
  ): Promise<CommandResponse<Commands[K]>>;
  handle<K extends keyof Commands>(
    name: K,
    handler: (
      request: CommandRequest<Commands[K]>,
    ) => CommandResponse<Commands[K]> | Promise<CommandResponse<Commands[K]>>,
  ): Disposable;
}

export interface TypedQueryBus<Queries> {
  query<K extends keyof Queries>(
    name: K,
    request: QueryRequest<Queries[K]>,
  ): Promise<QueryResponse<Queries[K]>>;
  handle<K extends keyof Queries>(
    name: K,
    handler: (
      request: QueryRequest<Queries[K]>,
    ) => QueryResponse<Queries[K]> | Promise<QueryResponse<Queries[K]>>,
  ): Disposable;
}
