import { describe, expect, test } from "vitest";
import { InMemoryEventBus } from "./event-bus";
import { InMemoryCommandBus, InMemoryQueryBus } from "./request-bus";

interface TestEvents {
  "demo.started": { id: string };
}

interface TestCommands {
  "demo.echo": {
    request: { value: string };
    response: { value: string };
  };
}

interface TestQueries {
  "demo.count": {
    request: Record<PropertyKey, never>;
    response: number;
  };
}

describe("event and request buses", () => {
  test("publish notifies subscribers", async () => {
    const bus = new InMemoryEventBus<TestEvents>();
    const seen: string[] = [];
    bus.subscribe("demo.started", (payload) => {
      seen.push(payload.id);
    });

    await bus.publish("demo.started", { id: "one" });

    expect(seen).toEqual(["one"]);
  });

  test("wait resolves matching event", async () => {
    const bus = new InMemoryEventBus<TestEvents>();
    const wait = bus.wait("demo.started", { predicate: (payload) => payload.id === "two" });

    await bus.publish("demo.started", { id: "one" });
    await bus.publish("demo.started", { id: "two" });

    await expect(wait).resolves.toEqual({ id: "two" });
  });

  test("command and query enforce single handler", async () => {
    const commands = new InMemoryCommandBus<TestCommands>();
    const queries = new InMemoryQueryBus<TestQueries>();

    commands.handle("demo.echo", (request) => ({ value: request.value }));
    queries.handle("demo.count", () => 3);

    expect(() => commands.handle("demo.echo", (request) => request)).toThrow();
    await expect(commands.execute("demo.echo", { value: "ok" })).resolves.toEqual({ value: "ok" });
    await expect(queries.query("demo.count", {})).resolves.toBe(3);
  });
});
