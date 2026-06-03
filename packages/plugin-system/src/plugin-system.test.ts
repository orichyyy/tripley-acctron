import { describe, expect, test } from "vitest";
import type { KioskEvents } from "@tripley-acctron/contracts";
import { InMemoryCommandBus, InMemoryEventBus, InMemoryQueryBus } from "@tripley-acctron/event-bus";
import { InMemoryLogger } from "@tripley-acctron/observability";
import { DefaultLifecycleRegistry } from "./lifecycle";
import { PluginRuntime } from "./plugin-runtime";
import { createServiceToken, DefaultServiceRegistry } from "./service-registry";

describe("plugin system", () => {
  test("service registry rejects duplicate providers", () => {
    const token = createServiceToken<string>("demo.service");
    const registry = new DefaultServiceRegistry();

    registry.provide(token, "one");

    expect(() => registry.provide(token, "two")).toThrow();
    expect(registry.get(token)).toBe("one");
  });

  test("plugin runtime rejects missing dependencies", async () => {
    const runtime = new PluginRuntime([
      {
        id: "demo",
        version: "0.1.0",
        dependsOn: ["missing"],
        setup() {},
      },
    ]);

    await expect(runtime.setup(testContext())).rejects.toThrow();
  });
});

function testContext() {
  return {
    role: "headlessTest" as const,
    events: new InMemoryEventBus<KioskEvents>(),
    commands: new InMemoryCommandBus(),
    queries: new InMemoryQueryBus(),
    services: new DefaultServiceRegistry(),
    lifecycle: new DefaultLifecycleRegistry(),
    logger: new InMemoryLogger(),
  };
}
