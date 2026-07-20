import { ConditionRegistry } from "@tripley-kit/web-container-condition-engine";
import { FrameworkUiPort, MemoryUiStateAdapter } from "@tripley-kit/web-container-ui-port";
import { describe, expect, it } from "vitest";

import { CommandRegistry, conditionResultToCommandResult } from "./index";

describe("CommandRegistry", () => {
  it("executes commands and updates loading state", async () => {
    const ui = new FrameworkUiPort({ navigate: () => {} }, new MemoryUiStateAdapter());
    const registry = new CommandRegistry();
    registry.register({
      execute: async (_ctx, input: { amount: number }) => input.amount * 2,
      id: "amount.double",
      options: { disableWhileRunning: true, showLoadingWhileRunning: true },
    });

    await expect(registry.execute("amount.double", { ui }, { amount: 21 })).resolves.toBe(42);
    expect(ui.getState({}, "command.amount.double")).toEqual({
      disabled: false,
      loading: false,
      running: false,
    });
  });

  it("uses command canExecute with async conditions", async () => {
    const conditions = new ConditionRegistry();
    conditions.register({
      id: "cash.available",
      evaluate: async () => ({ allowed: false, reasonCode: "cash.empty" }),
    });

    const registry = new CommandRegistry();
    registry.register({
      canExecute: async (ctx) => {
        if (!ctx.conditions) {
          return { allowed: false, reasonCode: "conditions.missing" };
        }

        return conditionResultToCommandResult(await ctx.conditions.evaluate("cash.available", ctx));
      },
      execute: async () => "started",
      id: "withdrawal.start",
    });

    await expect(
      registry.canExecute("withdrawal.start", { conditions }, undefined),
    ).resolves.toMatchObject({
      allowed: false,
      reasonCode: "cash.empty",
    });
  });

  it("runs command middleware around execution", async () => {
    const calls: string[] = [];
    const registry = new CommandRegistry();
    registry.registerMiddleware({
      afterExecute: async () => {
        calls.push("after");
      },
      beforeExecute: async () => {
        calls.push("before");
      },
      id: "trace",
    });
    registry.register({
      execute: async () => {
        calls.push("execute");
        return "ok";
      },
      id: "test.command",
    });

    await expect(registry.execute("test.command", {}, undefined)).resolves.toBe("ok");
    expect(calls).toEqual(["before", "execute", "after"]);
  });

  it("honors idempotency hooks", async () => {
    let calls = 0;
    const registry = new CommandRegistry();
    registry.register({
      execute: async () => {
        calls += 1;
        return calls;
      },
      id: "idempotent.command",
      options: { idempotencyKey: "same" },
    });

    await expect(registry.execute("idempotent.command", {}, undefined)).resolves.toBe(1);
    await expect(registry.execute("idempotent.command", {}, undefined)).resolves.toBe(1);
  });
});
