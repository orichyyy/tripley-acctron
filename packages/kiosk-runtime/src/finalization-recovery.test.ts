import { describe, expect, it } from "vitest";

import type { OperationFinalizationContext } from "./finalization-contracts";
import { OperationFinalizationRecoveryRegistry } from "./finalization-recovery";
import {
  OperationFinalizationRunner,
  OperationFinalizerRegistry,
} from "./finalization-runner";
import { InMemoryOperationFinalizationStore } from "./finalization-store";

describe("durable operation finalization recovery", () => {
  it("persists an explicitly projected context and resumes only incomplete steps", async () => {
    const store = new InMemoryOperationFinalizationStore();
    const calls: string[] = [];
    const first = runner(store, calls, true);

    await expect(first.run(context())).rejects.toThrow("restart-required");
    const failed = await store.load("operation-1");
    expect(failed?.recoveryContext).toMatchObject({
      metadata: { policyId: "withdrawal.standard" },
      operationId: "operation-1",
      result: { kind: "withdrawal.outcome", status: "completed" },
    });

    const recovery = new OperationFinalizationRecoveryRegistry().register(
      runner(store, calls, false),
    );
    await expect(recovery.resume([failed!])).resolves.toEqual({ status: "ready" });
    expect(calls).toEqual(["transaction", "scope", "scope"]);
    await expect(store.load("operation-1")).resolves.toMatchObject({ status: "completed" });
  });

  it("requires intervention when no compatible recovery plan is registered", async () => {
    const store = new InMemoryOperationFinalizationStore();
    const failedRunner = runner(store, [], true);
    await expect(failedRunner.run(context())).rejects.toThrow();
    const failed = await store.load("operation-1");

    await expect(new OperationFinalizationRecoveryRegistry().resume([failed!])).resolves.toEqual({
      reason: "finalization.recovery.plan-unavailable",
      status: "intervention",
    });
  });
});

const runner = (
  store: InMemoryOperationFinalizationStore,
  calls: string[],
  failScope: boolean,
): OperationFinalizationRunner => {
  const registry = new OperationFinalizerRegistry()
    .register({
      execute: async () => { calls.push("transaction"); },
      id: "transaction.finalize",
      version: "1",
    })
    .register({
      after: ["transaction.finalize"],
      execute: async () => {
        calls.push("scope");
        if (failScope) throw new Error("restart-required");
      },
      id: "scope.reset",
      version: "1",
    });
  return new OperationFinalizationRunner(registry, store, () => new Date(), {
    project: (value) => ({
      metadata: value.metadata,
      operationId: value.operationId,
      result: value.result,
    }),
  });
};

const context = (): OperationFinalizationContext => ({
  metadata: { policyId: "withdrawal.standard" },
  operationId: "operation-1",
  result: { kind: "withdrawal.outcome", status: "completed" },
});
