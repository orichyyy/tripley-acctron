import { describe, expect, it, vi } from "vitest";
import { TypedEventBus } from "./index.js";

interface Events {
  selected: { code: string };
}

describe("TypedEventBus", () => {
  it("publishes handlers in registration order", async () => {
    const calls: string[] = [];
    const bus = new TypedEventBus<Events>();
    bus.subscribe("selected", () => {
      calls.push("first");
    });
    bus.subscribe("selected", async () => {
      calls.push("second");
    });

    await bus.publish("selected", { code: "yes" });

    expect(calls).toEqual(["first", "second"]);
  });

  it("rethrows critical handler errors", async () => {
    const onHandlerError = vi.fn();
    const bus = new TypedEventBus<Events>({ onHandlerError });
    bus.subscribe("selected", () => {
      throw new Error("failed");
    });

    await expect(bus.publish("selected", { code: "yes" })).rejects.toThrow("failed");
    expect(onHandlerError).toHaveBeenCalledOnce();
  });

  it("continues best effort publication", async () => {
    const calls: string[] = [];
    const bus = new TypedEventBus<Events>();
    bus.subscribe("selected", () => {
      throw new Error("failed");
    });
    bus.subscribe("selected", () => {
      calls.push("continued");
    });

    await bus.publishBestEffort("selected", { code: "yes" });

    expect(calls).toEqual(["continued"]);
  });
});
