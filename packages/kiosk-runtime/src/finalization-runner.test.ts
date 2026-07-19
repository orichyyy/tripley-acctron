import { describe, expect, it, vi } from "vitest";
import { OperationFinalizationRunner, OperationFinalizerRegistry } from "./finalization-runner";
import { InMemoryOperationFinalizationStore } from "./finalization-store";

describe("OperationFinalizationRunner", () => {
  it("freezes dependency order and persists completed steps", async () => {
    const calls: string[] = [];
    const registry = new OperationFinalizerRegistry()
      .register({ id: "reset", version: "1", after: ["prompt"], execute: async () => { calls.push("reset"); } })
      .register({ id: "prompt", version: "1", execute: async () => { calls.push("prompt"); } });
    const runner = new OperationFinalizationRunner(registry, new InMemoryOperationFinalizationStore());

    const result = await runner.run({ operationId: "operation-1" });

    expect(calls).toEqual(["prompt", "reset"]);
    expect(result.status).toBe("completed");
    expect(result.steps.every((step) => step.status === "completed")).toBe(true);
  });

  it("resumes without repeating completed finalizers", async () => {
    const store = new InMemoryOperationFinalizationStore();
    const first = vi.fn(async () => undefined);
    const second = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(undefined);
    const registry = new OperationFinalizerRegistry()
      .register({ id: "first", version: "1", execute: first })
      .register({ id: "second", version: "1", after: ["first"], execute: second });
    const runner = new OperationFinalizationRunner(registry, store);

    await expect(runner.run({ operationId: "operation-2" })).rejects.toThrow("temporary");
    const result = await runner.run({ operationId: "operation-2" });

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("completed");
  });
});
