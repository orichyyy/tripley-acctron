import { describe, expect, it } from "vitest";
import { PluginManager } from "./index.js";

describe("PluginManager", () => {
  it("runs setup and start in order and stop in reverse order", async () => {
    const calls: string[] = [];
    const manager = new PluginManager([
      {
        name: "one",
        setup: () => {
          calls.push("setup-one");
        },
        start: () => {
          calls.push("start-one");
        },
        stop: () => {
          calls.push("stop-one");
        },
      },
      {
        name: "two",
        setup: () => {
          calls.push("setup-two");
        },
        start: () => {
          calls.push("start-two");
        },
        stop: () => {
          calls.push("stop-two");
        },
      },
    ]);

    await manager.setup();
    await manager.start();
    await manager.stop();

    expect(calls).toEqual([
      "setup-one",
      "setup-two",
      "start-one",
      "start-two",
      "stop-two",
      "stop-one",
    ]);
  });

  it("rejects duplicate names", () => {
    expect(() => new PluginManager([{ name: "same" }, { name: "same" }])).toThrow(
      "Duplicate plugin",
    );
  });
});
