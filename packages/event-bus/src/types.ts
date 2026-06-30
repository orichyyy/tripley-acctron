import type { MaybePromise } from "@tripley/web-container-types";
import type { Disposable, Subscription } from "@tripley/web-container-utils";

export type EventSourceKind =
  | "core"
  | "native"
  | "plugin"
  | "flow"
  | "window"
  | "ui"
  | "project"
  | "device";

export type EventPriority = "low" | "normal" | "high";

export interface EventTargetRef {
  readonly kind: EventSourceKind;
  readonly id?: string | undefined;
}

export interface EventEnvelopeMeta {
  readonly timestamp: number;
  readonly source: EventSourceKind;
  readonly sourceId?: string | undefined;
  readonly target?: EventTargetRef | undefined;
  readonly correlationId?: string | undefined;
  readonly causationId?: string | undefined;
  readonly traceId?: string | undefined;
  readonly windowId?: string | undefined;
  readonly flowInstanceId?: string | undefined;
  readonly pluginId?: string | undefined;
  readonly priority?: EventPriority | undefined;
  readonly ttlMs?: number | undefined;
}

export interface EventEnvelope<Topic extends string = string, Payload = unknown> {
  readonly id: string;
  readonly topic: Topic;
  readonly payload: Payload;
  readonly meta: EventEnvelopeMeta;
}

export interface PublishOptions extends Partial<Omit<EventEnvelopeMeta, "timestamp">> {
  readonly id?: string | undefined;
}

export interface SubscribeOptions {
  readonly id?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly errorMode?: "isolate" | "fail-publish" | undefined;
  readonly filter?: ((envelope: EventEnvelope) => boolean) | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface RequestOptions extends PublishOptions {
  readonly timeoutMs?: number | undefined;
}

export interface OnceOptions extends SubscribeOptions {
  readonly timeoutMs?: number | undefined;
}

export interface EventScope {
  readonly source: EventSourceKind;
  readonly sourceId?: string | undefined;
  readonly windowId?: string | undefined;
  readonly flowInstanceId?: string | undefined;
  readonly pluginId?: string | undefined;
}

export interface HandlerResult {
  readonly handlerId: string;
  readonly status: "completed" | "failed" | "timedOut" | "skipped";
  readonly durationMs: number;
  readonly error?: unknown | undefined;
}

export interface PublishResult {
  readonly envelope: EventEnvelope;
  readonly handlerResults: readonly HandlerResult[];
  readonly ok: boolean;
}

export interface EventDeadLetteredPayload {
  readonly event: EventEnvelope;
  readonly failedHandlers: readonly HandlerResult[];
  readonly reason: string;
}

export interface CoreEventMap {
  "core.event.deadLettered": EventDeadLetteredPayload;
}

export type EventHandler<Payload> = (
  envelope: EventEnvelope<string, Payload>,
) => MaybePromise<void>;

export type RequestHandler<Payload, Response> = (
  envelope: EventEnvelope<string, Payload>,
) => MaybePromise<Response>;

export type EventSubscription = Subscription;

export interface EventTransport extends Disposable {
  readonly id: string;
  publish(envelope: EventEnvelope): Promise<void>;
  subscribe(handler: (envelope: EventEnvelope) => MaybePromise<void>): EventSubscription;
}

export interface EventBus<EventMap extends object> extends Disposable {
  publish<Topic extends keyof EventMap & string>(
    topic: Topic,
    payload: EventMap[Topic],
    options?: PublishOptions,
  ): Promise<PublishResult>;
  subscribe<Topic extends keyof EventMap & string>(
    topic: Topic,
    handler: EventHandler<EventMap[Topic]>,
    options?: SubscribeOptions,
  ): EventSubscription;
  request<Topic extends keyof EventMap & string, Response = unknown>(
    topic: Topic,
    payload: EventMap[Topic],
    options?: RequestOptions,
  ): Promise<Response>;
  respond<Topic extends keyof EventMap & string, Response = unknown>(
    topic: Topic,
    handler: RequestHandler<EventMap[Topic], Response>,
    options?: SubscribeOptions,
  ): EventSubscription;
  once<Topic extends keyof EventMap & string>(
    topic: Topic,
    options?: OnceOptions,
  ): Promise<EventEnvelope<Topic, EventMap[Topic]>>;
  createScope(scope: EventScope): ScopedEventBus<EventMap>;
}

export type ScopedEventBus<EventMap extends object> = EventBus<EventMap>;
