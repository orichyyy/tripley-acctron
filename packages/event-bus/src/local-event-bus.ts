import { FrameworkError } from "@tripley/web-container-errors";
import { BasicSubscription, type IdGenerator, systemClock } from "@tripley/web-container-utils";
import { type EventTracer, MemoryEventTracer, traceEnvelope, traceHandler } from "./tracer";
import type {
  CoreEventMap,
  EventBus,
  EventDeadLetteredPayload,
  EventEnvelope,
  EventHandler,
  EventScope,
  EventSubscription,
  HandlerResult,
  OnceOptions,
  PublishOptions,
  PublishResult,
  RequestHandler,
  RequestOptions,
  ScopedEventBus,
  SubscribeOptions,
} from "./types";

interface RegisteredHandler {
  readonly id: string;
  readonly topic: string;
  readonly handler: EventHandler<unknown>;
  readonly options: RegisteredOptions;
}

interface RegisteredResponder {
  readonly id: string;
  readonly topic: string;
  readonly handler: RequestHandler<unknown, unknown>;
  readonly options: RegisteredOptions;
}

interface RegisteredOptions {
  readonly id?: string | undefined;
  readonly timeoutMs: number;
  readonly errorMode: "isolate" | "fail-publish";
  readonly filter?: ((envelope: EventEnvelope) => boolean) | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface LocalEventBusOptions {
  readonly defaultTimeoutMs?: number;
  readonly idGenerator?: IdGenerator;
  readonly scope?: EventScope;
  readonly tracer?: EventTracer;
}

export class LocalEventBus<EventMap extends object = CoreEventMap> implements EventBus<EventMap> {
  private readonly defaultTimeoutMs: number;
  private readonly handlers = new Map<string, RegisteredHandler[]>();
  private readonly idGenerator: IdGenerator;
  private readonly publishQueues = new Map<string, Promise<PublishResult>>();
  private readonly responders = new Map<string, RegisteredResponder[]>();
  private readonly scope: EventScope | undefined;
  private readonly tracer: EventTracer;

  public constructor(options: LocalEventBusOptions = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 5000;
    this.idGenerator = options.idGenerator ?? {
      nextId: (prefix = "event") => `${prefix}_${crypto.randomUUID()}`,
    };
    this.scope = options.scope;
    this.tracer = options.tracer ?? new MemoryEventTracer();
  }

  public async publish<Topic extends keyof EventMap & string>(
    topic: Topic,
    payload: EventMap[Topic],
    options: PublishOptions = {},
  ): Promise<PublishResult> {
    const envelope = this.createEnvelope(topic, payload, options);
    const queueKey = `${envelope.meta.sourceId ?? envelope.meta.source}:${topic}`;
    const previous = this.publishQueues.get(queueKey) ?? Promise.resolve(undefined as never);
    const next = previous.catch(() => undefined).then(() => this.dispatchEnvelope(envelope));
    this.publishQueues.set(queueKey, next);
    return next;
  }

  public subscribe<Topic extends keyof EventMap & string>(
    topic: Topic,
    handler: EventHandler<EventMap[Topic]>,
    options: SubscribeOptions = {},
  ): EventSubscription {
    const registered = this.createRegisteredHandler(
      topic,
      handler as EventHandler<unknown>,
      options,
    );
    const handlers = this.handlers.get(topic) ?? [];
    handlers.push(registered);
    this.handlers.set(topic, handlers);
    options.signal?.addEventListener("abort", () => this.removeHandler(registered));
    return new BasicSubscription(() => this.removeHandler(registered));
  }

  public async request<Topic extends keyof EventMap & string, Response = unknown>(
    topic: Topic,
    payload: EventMap[Topic],
    options: RequestOptions = {},
  ): Promise<Response> {
    const envelope = this.createEnvelope(topic, payload, options);
    const responders = this.responders.get(topic) ?? [];
    this.tracer.record(traceEnvelope("request.started", envelope));
    for (const responder of responders) {
      if (responder.options.filter && !responder.options.filter(envelope)) {
        continue;
      }

      try {
        const response = await withTimeout(
          () => responder.handler(envelope),
          options.timeoutMs ?? responder.options.timeoutMs,
          `Request responder timed out: ${responder.id}`,
        );
        this.tracer.record(traceEnvelope("response.received", envelope));
        return response as Response;
      } catch {}
    }

    throw new FrameworkError({
      category: "extension",
      code: "eventBus.request.noResponder",
      message: `No successful responder for topic: ${topic}`,
      metadata: { topic },
    });
  }

  public respond<Topic extends keyof EventMap & string, Response = unknown>(
    topic: Topic,
    handler: RequestHandler<EventMap[Topic], Response>,
    options: SubscribeOptions = {},
  ): EventSubscription {
    const registered: RegisteredResponder = {
      handler: handler as RequestHandler<unknown, unknown>,
      id: options.id ?? this.idGenerator.nextId("responder"),
      options: normalizeSubscribeOptions(options, this.defaultTimeoutMs),
      topic,
    };
    const responders = this.responders.get(topic) ?? [];
    responders.push(registered);
    this.responders.set(topic, responders);
    options.signal?.addEventListener("abort", () => this.removeResponder(registered));
    return new BasicSubscription(() => this.removeResponder(registered));
  }

  public once<Topic extends keyof EventMap & string>(
    topic: Topic,
    options: OnceOptions = {},
  ): Promise<EventEnvelope<Topic, EventMap[Topic]>> {
    return new Promise((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const subscription = this.subscribe(
        topic,
        (envelope) => {
          void subscription.unsubscribe();
          if (timeout) {
            clearTimeout(timeout);
          }
          resolve(envelope as EventEnvelope<Topic, EventMap[Topic]>);
        },
        options,
      );
      if (options.timeoutMs) {
        timeout = setTimeout(() => {
          void subscription.unsubscribe();
          reject(new Error(`Timed out waiting for event: ${topic}`));
        }, options.timeoutMs);
      }
    });
  }

  public createScope(scope: EventScope): ScopedEventBus<EventMap> {
    return new LocalEventBus<EventMap>({
      defaultTimeoutMs: this.defaultTimeoutMs,
      idGenerator: this.idGenerator,
      scope: { ...this.scope, ...scope },
      tracer: this.tracer,
    });
  }

  public async dispose(): Promise<void> {
    this.handlers.clear();
    this.responders.clear();
    this.publishQueues.clear();
  }

  private async dispatchEnvelope(envelope: EventEnvelope): Promise<PublishResult> {
    this.tracer.record(traceEnvelope("event.published", envelope));
    const handlers = this.handlers.get(envelope.topic) ?? [];
    const handlerResults = await Promise.all(
      handlers.map((registered) => this.invokeHandler(registered, envelope)),
    );
    const failedHandlers = handlerResults.filter(
      (result) => result.status === "failed" || result.status === "timedOut",
    );

    if (failedHandlers.length > 0 && envelope.topic !== "core.event.deadLettered") {
      await this.emitDeadLetter(envelope, failedHandlers);
    }

    const failPublish = handlers.some(
      (handler) =>
        handler.options.errorMode === "fail-publish" &&
        failedHandlers.some((result) => result.handlerId === handler.id),
    );
    const result = {
      envelope,
      handlerResults,
      ok: failedHandlers.length === 0,
    };
    if (failPublish) {
      throw new FrameworkError({
        category: "extension",
        code: "eventBus.publish.failed",
        message: `Event publish failed for topic: ${envelope.topic}`,
        metadata: { topic: envelope.topic },
      });
    }

    return result;
  }

  private async invokeHandler(
    registered: RegisteredHandler,
    envelope: EventEnvelope,
  ): Promise<HandlerResult> {
    const startedAt = systemClock.nowEpochMs();
    if (registered.options.filter && !registered.options.filter(envelope)) {
      return {
        durationMs: 0,
        handlerId: registered.id,
        status: "skipped",
      };
    }

    this.tracer.record({
      envelopeId: envelope.id,
      handlerId: registered.id,
      kind: "handler.started",
      timestamp: startedAt,
      topic: envelope.topic,
      traceId: envelope.meta.traceId,
    });

    try {
      await withTimeout(
        () => registered.handler(envelope),
        registered.options.timeoutMs,
        `Event handler timed out: ${registered.id}`,
      );
      const result = {
        durationMs: systemClock.nowEpochMs() - startedAt,
        handlerId: registered.id,
        status: "completed" as const,
      };
      this.tracer.record(traceHandler("handler.completed", envelope, result));
      return result;
    } catch (error) {
      const status = error instanceof TimeoutError ? "timedOut" : "failed";
      const result = {
        durationMs: systemClock.nowEpochMs() - startedAt,
        error,
        handlerId: registered.id,
        status,
      } satisfies HandlerResult;
      this.tracer.record(traceHandler("handler.failed", envelope, result));
      return result;
    }
  }

  private async emitDeadLetter(
    envelope: EventEnvelope,
    failedHandlers: readonly HandlerResult[],
  ): Promise<void> {
    const payload: EventDeadLetteredPayload = {
      event: envelope,
      failedHandlers,
      reason: failedHandlers.map((handler) => `${handler.handlerId}:${handler.status}`).join(","),
    };
    this.tracer.record(traceEnvelope("deadLetter.emitted", envelope));
    await this.publish(
      "core.event.deadLettered" as keyof EventMap & string,
      payload as EventMap[keyof EventMap & string],
      {
        causationId: envelope.id,
        correlationId: envelope.meta.correlationId,
        source: "core",
        traceId: envelope.meta.traceId,
      },
    );
  }

  private createEnvelope<Topic extends string, Payload>(
    topic: Topic,
    payload: Payload,
    options: PublishOptions,
  ): EventEnvelope<Topic, Payload> {
    return {
      id: options.id ?? this.idGenerator.nextId("event"),
      meta: {
        ...this.scope,
        ...options,
        source: options.source ?? this.scope?.source ?? "core",
        timestamp: systemClock.nowEpochMs(),
      },
      payload,
      topic,
    };
  }

  private createRegisteredHandler(
    topic: string,
    handler: EventHandler<unknown>,
    options: SubscribeOptions,
  ): RegisteredHandler {
    return {
      handler,
      id: options.id ?? this.idGenerator.nextId("handler"),
      options: normalizeSubscribeOptions(options, this.defaultTimeoutMs),
      topic,
    };
  }

  private removeHandler(handler: RegisteredHandler): void {
    const handlers = this.handlers.get(handler.topic) ?? [];
    this.handlers.set(
      handler.topic,
      handlers.filter((candidate) => candidate !== handler),
    );
  }

  private removeResponder(responder: RegisteredResponder): void {
    const responders = this.responders.get(responder.topic) ?? [];
    this.responders.set(
      responder.topic,
      responders.filter((candidate) => candidate !== responder),
    );
  }
}

class TimeoutError extends Error {}

const normalizeSubscribeOptions = (
  options: SubscribeOptions,
  defaultTimeoutMs: number,
): RegisteredOptions => ({
  ...options,
  errorMode: options.errorMode ?? "isolate",
  timeoutMs: options.timeoutMs ?? defaultTimeoutMs,
});

const withTimeout = async <T>(
  operation: () => T | Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new TimeoutError(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};
