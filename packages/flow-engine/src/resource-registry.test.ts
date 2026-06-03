import { describe, expect, test } from "vitest";
import { InMemoryLogger } from "@tripley-acctron/observability";
import { InMemoryTransactionResourceRegistry } from "./resource-registry";

describe("transaction resource registry", () => {
  test("recovers active resources in reverse order", async () => {
    const registry = new InMemoryTransactionResourceRegistry(new InMemoryLogger());
    const calls: string[] = [];

    registry.register("card", {
      onNormalEnd: async () => {
        calls.push("card");
      },
    });
    registry.register("cash", {
      onNormalEnd: async () => {
        calls.push("cash");
      },
    });

    await registry.recover("normalEnd");

    expect(calls).toEqual(["cash", "card"]);
  });

  test("disposed resources are skipped", async () => {
    const registry = new InMemoryTransactionResourceRegistry(new InMemoryLogger());
    const calls: string[] = [];
    const disposable = registry.register("card", {
      onCancel: async () => {
        calls.push("card");
      },
    });

    disposable.dispose();
    await registry.recover("cancel");

    expect(calls).toEqual([]);
  });

  test("logs failed resources and continues recovery", async () => {
    const logger = new InMemoryLogger();
    const registry = new InMemoryTransactionResourceRegistry(logger);
    const calls: string[] = [];

    registry.register("first", {
      onError: async () => {
        calls.push("first");
      },
    });
    registry.register("second", {
      onError: async () => {
        throw new Error("recover failed");
      },
    });

    await expect(registry.recover("unhandledError")).rejects.toMatchObject({
      code: "recovery.failed",
    });

    expect(calls).toEqual(["first"]);
    expect(
      logger.entries.some((entry) => entry.message === "Transaction resource recovery failed."),
    ).toBe(true);
  });
});
