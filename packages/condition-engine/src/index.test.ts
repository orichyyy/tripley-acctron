import { describe, expect, it } from "vitest";

import { ConditionRegistry, enabledWhen, visibleWhen } from "./index";

describe("ConditionRegistry", () => {
  it("evaluates sync and async conditions for UI helpers", async () => {
    const registry = new ConditionRegistry();
    registry.register({
      id: "session.ready",
      evaluate: () => true,
    });
    registry.register({
      id: "device.ready",
      evaluate: async () => ({ allowed: true }),
    });
    registry.register({
      id: "cash.available",
      evaluate: async () => ({
        allowed: false,
        reasonCode: "cash.empty",
      }),
    });

    await expect(visibleWhen(registry, "session.ready", {})).resolves.toBe(true);
    await expect(enabledWhen(registry, ["session.ready", "device.ready"], {})).resolves.toBe(true);
    await expect(enabledWhen(registry, ["session.ready", "cash.available"], {})).resolves.toBe(
      false,
    );
    await expect(registry.evaluate("cash.available", {})).resolves.toMatchObject({
      allowed: false,
      reasonCode: "cash.empty",
    });
  });
});
