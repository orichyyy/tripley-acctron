import type { EventEnvelope, HandlerResult } from "./types";

export type EventTraceKind =
  | "event.published"
  | "handler.started"
  | "handler.completed"
  | "handler.failed"
  | "request.started"
  | "response.received"
  | "deadLetter.emitted";

export interface EventTraceRecord {
  readonly kind: EventTraceKind;
  readonly timestamp: number;
  readonly envelopeId?: string | undefined;
  readonly topic?: string | undefined;
  readonly handlerId?: string | undefined;
  readonly traceId?: string | undefined;
  readonly detail?: unknown | undefined;
}

export interface EventTracer {
  record(record: EventTraceRecord): void;
}

export class NoopEventTracer implements EventTracer {
  public record(): void {
    return;
  }
}

export class MemoryEventTracer implements EventTracer {
  private readonly records: EventTraceRecord[] = [];

  public constructor(private readonly maxRecords = 1000) {}

  public record(record: EventTraceRecord): void {
    this.records.push(record);
    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }
  }

  public list(): readonly EventTraceRecord[] {
    return [...this.records];
  }

  public clear(): void {
    this.records.splice(0);
  }
}

export const traceEnvelope = (kind: EventTraceKind, envelope: EventEnvelope): EventTraceRecord => ({
  envelopeId: envelope.id,
  kind,
  timestamp: Date.now(),
  topic: envelope.topic,
  traceId: envelope.meta.traceId,
});

export const traceHandler = (
  kind: "handler.completed" | "handler.failed",
  envelope: EventEnvelope,
  result: HandlerResult,
): EventTraceRecord => ({
  detail: { durationMs: result.durationMs, status: result.status },
  envelopeId: envelope.id,
  handlerId: result.handlerId,
  kind,
  timestamp: Date.now(),
  topic: envelope.topic,
  traceId: envelope.meta.traceId,
});
