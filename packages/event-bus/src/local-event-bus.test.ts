import { describe, expect, it } from "vitest";
import { LocalEventBus } from "./local-event-bus";
import { MemoryEventTracer } from "./tracer";
import type { CoreEventMap, EventDeadLetteredPayload } from "./types";

interface TestEventMap extends CoreEventMap {
  "test.created": { readonly value: number };
  "test.request": { readonly value: number };
}

describe("LocalEventBus", () => {
  it("dispatches async handlers and returns isolated handler results without retry", async () => {
    const bus = new LocalEventBus<TestEventMap>({ defaultTimeoutMs: 50 });
    const calls: string[] = [];

    bus.subscribe("test.created", async () => {
      calls.push("first");
    });
    bus.subscribe("test.created", async () => {
      calls.push("second");
      throw new Error("handler failed");
    });
    bus.subscribe("test.created", async () => {
      calls.push("third");
    });

    const result = await bus.publish("test.created", { value: 1 });

    expect(calls).toEqual(["first", "second", "third"]);
    expect(result.ok).toBe(false);
    expect(result.handlerResults.map((handler) => handler.status)).toEqual([
      "completed",
      "failed",
      "completed",
    ]);
  });

  it("emits dead-letter events for failed handlers", async () => {
    const bus = new LocalEventBus<TestEventMap>({ defaultTimeoutMs: 50 });
    const deadLetters: EventDeadLetteredPayload[] = [];
    bus.subscribe("core.event.deadLettered", (event) => {
      deadLetters.push(event.payload);
    });
    bus.subscribe("test.created", async () => {
      throw new Error("boom");
    });

    await bus.publish("test.created", { value: 1 });

    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]?.event.topic).toBe("test.created");
    expect(deadLetters[0]?.failedHandlers[0]?.status).toBe("failed");
  });

  it("times out individual handlers while allowing other handlers to complete", async () => {
    const bus = new LocalEventBus<TestEventMap>({ defaultTimeoutMs: 5 });
    const calls: string[] = [];
    bus.subscribe("test.created", async () => new Promise((resolve) => setTimeout(resolve, 20)));
    bus.subscribe("test.created", async () => {
      calls.push("completed");
    });

    const result = await bus.publish("test.created", { value: 1 });

    expect(calls).toEqual(["completed"]);
    expect(result.handlerResults.map((handler) => handler.status)).toContain("timedOut");
  });

  it("uses the first successful request responder", async () => {
    const bus = new LocalEventBus<TestEventMap>();
    bus.respond("test.request", async () => {
      throw new Error("not this one");
    });
    bus.respond("test.request", async (event) => event.payload.value * 2);

    await expect(bus.request<"test.request", number>("test.request", { value: 21 })).resolves.toBe(
      42,
    );
  });

  it("records memory trace entries", async () => {
    const tracer = new MemoryEventTracer();
    const bus = new LocalEventBus<TestEventMap>({ tracer });
    bus.subscribe("test.created", async () => undefined);

    await bus.publish("test.created", { value: 1 });

    expect(tracer.list().map((record) => record.kind)).toEqual(
      expect.arrayContaining(["event.published", "handler.started", "handler.completed"]),
    );
  });
});
