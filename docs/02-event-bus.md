# 02. Event Bus

## Purpose

The Event Bus is the typed asynchronous communication layer between native events, plugins, windows, flows, UI, storage, and project domain events.

It is not a retry engine and it is not the permission enforcement layer in v1.

## Decisions

- Scope: Native SDK / Plugin / Flow / Window / UI / Project events.
- Dispatch: async handlers, error isolation, timeout, trace, dead-letter.
- Retry: no automatic retry in Event Bus v1. Flow Engine or resilience policies own retries.
- Types: core event map is strongly typed; plugins extend through manifest and TypeScript module augmentation.
- Naming namespace: recommended, not enforced.
- Ordering: same publisher + same topic publish order is guaranteed.
- Request/response default: first successful responder.
- Cross-window v1: BroadcastChannel transport first. Native transport later.
- Trace: memory + optional SQLite.

## Event naming convention

```text
core.app.*
core.event.*
core.window.*
core.flow.*
core.ui.*
core.config.*
native.*
plugin.{pluginId}.*
project.{projectId}.*
project.kiosk.*
device.*
```

## Core API

```ts
export interface EventBus<EventMap extends Record<string, unknown>> {
  publish<Topic extends keyof EventMap & string>(
    topic: Topic,
    payload: EventMap[Topic],
    options?: PublishOptions
  ): Promise<PublishResult>;

  subscribe<Topic extends keyof EventMap & string>(
    topic: Topic,
    handler: EventHandler<EventMap[Topic]>,
    options?: SubscribeOptions
  ): EventSubscription;

  request<Topic extends keyof EventMap & string, Response = unknown>(
    topic: Topic,
    payload: EventMap[Topic],
    options?: RequestOptions
  ): Promise<Response>;

  respond<Topic extends keyof EventMap & string, Response = unknown>(
    topic: Topic,
    handler: RequestHandler<EventMap[Topic], Response>,
    options?: SubscribeOptions
  ): EventSubscription;

  once<Topic extends keyof EventMap & string>(
    topic: Topic,
    options?: OnceOptions
  ): Promise<EventEnvelope<Topic, EventMap[Topic]>>;

  createScope(scope: EventScope): ScopedEventBus<EventMap>;
  dispose(): Promise<void>;
}
```

## Envelope

```ts
export interface EventEnvelope<Topic extends string = string, Payload = unknown> {
  id: string;
  topic: Topic;
  payload: Payload;
  meta: {
    timestamp: number;
    source: 'core' | 'native' | 'plugin' | 'flow' | 'window' | 'ui' | 'project' | 'device';
    sourceId?: string;
    target?: EventTargetRef;
    correlationId?: string;
    causationId?: string;
    traceId?: string;
    windowId?: string;
    flowInstanceId?: string;
    pluginId?: string;
    priority?: 'low' | 'normal' | 'high';
    ttlMs?: number;
  };
}
```

## Handler behavior

Each handler has isolated timeout and error capture.

```ts
export interface SubscribeOptions {
  id?: string;
  timeoutMs?: number;
  errorMode?: 'isolate' | 'fail-publish';
  filter?: (envelope: EventEnvelope) => boolean;
  signal?: AbortSignal;
}
```

Default:

```text
timeoutMs = 5000
errorMode = isolate
retry = none
```

## Dead letter

Final handler failure emits:

```text
core.event.deadLettered
```

Payload:

```ts
export interface EventDeadLetteredPayload {
  event: EventEnvelope;
  failedHandlers: HandlerResult[];
  reason: string;
}
```

## Transports

```ts
export interface EventTransport {
  id: string;
  publish(envelope: EventEnvelope): Promise<void>;
  subscribe(handler: (envelope: EventEnvelope) => void | Promise<void>): EventSubscription;
  dispose(): Promise<void>;
}
```

Built-ins:

- `LocalEventTransport`
- `BroadcastChannelTransport`
- `HostWindowTransport` interface only until native window bridge exists
- optional `WebSocketEventTransport`

## Trace

`MemoryEventTracer` is default in dev. `NoopEventTracer` is default in prod unless enabled. SQLite trace is optional.

Trace records include:

```text
event published
handler started
handler completed
handler failed
request started
response received
dead-letter emitted
```

## Security

Event Bus does not enforce plugin permissions in v1. It records undeclared publish/subscribe in dev warning and prod trace.
