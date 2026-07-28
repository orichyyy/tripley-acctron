import { FrameworkUiPort, MemoryUiStateAdapter } from "@tripley-kit/web-container-ui-port";
import { describe, expect, it } from "vitest";

import {
  type ActionFlowNodeDefinition,
  type DecisionFlowNodeDefinition,
  type TerminalFlowNodeDefinition,
} from "./builtin-nodes";
import { defineFlow } from "./dsl";
import { createFlowEngine } from "./engine";
import { UiPortFlowProjectionAdapter } from "./projection";
import type {
  FlowExecutionContext,
  SubflowNodeDefinition,
} from "./types";

describe("ExecutableFlowEngine", () => {
  it("executes action, decision, and terminal nodes", async () => {
    const engine = createFlowEngine();
    engine.register(
      defineFlow({
        edges: [
          { branch: "approved", from: "decide", to: "finish" },
        ],
        id: "test.execution",
        nodes: {
          decide: {
            decide: () => "approved",
            id: "decide",
            kind: "decision",
          } satisfies DecisionFlowNodeDefinition,
          finish: {
            id: "finish",
            kind: "terminal",
          } satisfies TerminalFlowNodeDefinition,
          prepare: {
            id: "prepare",
            kind: "action",
            next: "decide",
            run: () => ({ safeReference: "tx-1" }),
          } satisfies ActionFlowNodeDefinition,
        },
        startNodeId: "prepare",
        version: "1.0.0",
      }),
    );

    const instance = await engine.start("test.execution", {});
    const result = await instance.completion;

    expect(result.status).toBe("completed");
    expect(result.path).toEqual(["prepare", "decide", "finish"]);
    expect(result.output).toEqual({ safeReference: "tx-1" });
  });

  it("cancels active node work and executes finally", async () => {
    let finallyCalled = false;
    const engine = createFlowEngine();
    engine.register(
      defineFlow({
        finally: async () => {
          finallyCalled = true;
        },
        id: "test.cancel",
        nodes: {
          wait: {
            id: "wait",
            kind: "action",
            run: (ctx) =>
              new Promise((resolve) => {
                ctx.signal?.addEventListener(
                  "abort",
                  () =>
                    resolve({
                      reasonCode: "NODE.ABORTED",
                      source: "system",
                      type: "cancel",
                    }),
                  { once: true },
                );
              }),
          } satisfies ActionFlowNodeDefinition,
        },
        startNodeId: "wait",
        version: "1.0.0",
      }),
    );

    const instance = await engine.start("test.cancel", {});
    await engine.cancel(instance.instanceId, {
      reasonCode: "USER.CANCELLED",
      source: "user",
    });
    const result = await instance.completion;

    expect(result.status).toBe("cancelled");
    expect(result.result).toMatchObject({
      reasonCode: "USER.CANCELLED",
      type: "cancel",
    });
    expect(finallyCalled).toBe(true);
  });

  it("pauses a wait node and resumes at its next node", async () => {
    const engine = createFlowEngine();
    engine.register(
      defineFlow({
        id: "test.resume",
        nodes: {
          finish: {
            id: "finish",
            kind: "terminal",
            output: { resumed: true },
          } satisfies TerminalFlowNodeDefinition,
          wait: {
            id: "wait",
            kind: "waitEvent",
            next: "finish",
            waitFor: { topic: "customer.confirmed" },
          },
        },
        startNodeId: "wait",
        version: "1.0.0",
      }),
    );

    const instance = await engine.start("test.resume", {});
    await waitUntil(() => instance.snapshot().status === "paused");
    await engine.resume(instance.instanceId, { confirmed: true });
    const result = await instance.completion;

    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ resumed: true });
  });

  it("publishes safe flow state through UiPort", async () => {
    const ui = new FrameworkUiPort(
      { navigate: () => {} },
      new MemoryUiStateAdapter(),
    );
    const engine = createFlowEngine({
      projection: new UiPortFlowProjectionAdapter(ui),
    });
    engine.register(
      defineFlow({
        id: "test.projection",
        nodes: {
          finish: {
            id: "finish",
            kind: "terminal",
            output: "sensitive-output",
          } satisfies TerminalFlowNodeDefinition,
        },
        startNodeId: "finish",
        version: "1.0.0",
      }),
    );

    const instance = await engine.start("test.projection", {});
    await instance.completion;
    const projected = ui.getState<Record<string, unknown>>(
      { flowInstanceId: instance.instanceId },
      "flow.instance",
    );

    expect(projected).toMatchObject({
      currentNodeId: "finish",
      status: "completed",
    });
    expect(JSON.stringify(projected)).not.toContain("sensitive-output");
  });

  it("bounds retained completed instance snapshots", async () => {
    const engine = createFlowEngine({
      completedInstanceRetention: { maxCount: 1 },
    });
    engine.register(
      defineFlow({
        id: "test.retention",
        nodes: {
          finish: {
            id: "finish",
            kind: "terminal",
          } satisfies TerminalFlowNodeDefinition,
        },
        startNodeId: "finish",
        version: "1.0.0",
      }),
    );

    const first = await engine.start("test.retention", {});
    await first.completion;
    const second = await engine.start("test.retention", {});
    await second.completion;

    await expect(engine.getInstance(first.instanceId)).resolves.toBeNull();
    await expect(
      engine.getInstance(second.instanceId),
    ).resolves.toMatchObject({ status: "completed" });
  });

  it("binds dynamic input and validated output for a versioned subflow", async () => {
    const accepted: unknown[] = [];
    const engine = createFlowEngine();
    engine.register(
      defineFlow({
        id: "test.child",
        inputSchema: {
          validate: (value) => value as { accountId: string },
        },
        nodes: {
          finish: {
            id: "finish",
            kind: "terminal",
            output: (ctx: FlowExecutionContext) => ({
              accountId: (ctx.input as { accountId: string }).accountId,
              balance: 1200,
            }),
          } satisfies TerminalFlowNodeDefinition,
        },
        outputSchema: {
          validate: (value) => {
            const output = value as { accountId: string; balance: number };
            if (typeof output.balance !== "number") {
              throw new Error("Invalid child output.");
            }
            return output;
          },
        },
        startNodeId: "finish",
        version: "2.0.0",
      }),
    );
    engine.register(
      defineFlow({
        id: "test.parent",
        nodes: {
          child: {
            id: "child",
            kind: "subflow",
            subflow: {
              acceptOutput: (output: unknown) => {
                accepted.push(output);
              },
              flowId: "test.child",
              input: () => ({ accountId: "001" }),
              mode: "sync",
              version: "2.0.0",
            },
          } satisfies SubflowNodeDefinition,
        },
        startNodeId: "child",
        version: "1.0.0",
      }),
    );

    const instance = await engine.start("test.parent", {});
    const result = await instance.completion;

    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ accountId: "001", balance: 1200 });
    expect(accepted).toEqual([{ accountId: "001", balance: 1200 }]);
  });
});

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for flow state.");
}
