import { describe, expect, it } from "vitest";

import { createFlowEngine } from "./engine";
import { defineFlow, defineSubflowContract, defineSubflowNode } from "./dsl";
import type {
  ActionFlowNodeDefinition,
  TerminalFlowNodeDefinition,
  UiFeedbackState,
} from "./types";

describe("subflow UI feedback", () => {
  it("forwards safe child feedback to the parent start callback", async () => {
    const child = defineFlow({
      id: "test.feedback.child",
      nodes: {
        publishFeedback: {
          id: "publishFeedback",
          kind: "action",
          next: "done",
          run: (ctx) => {
            ctx.setUiFeedback({
              safeData: { digitCount: 1, state: "changed" },
              stateKey: "test.pin",
              status: "waiting",
            });
          },
        } satisfies ActionFlowNodeDefinition,
        done: {
          id: "done",
          kind: "terminal",
          output: { status: "completed" },
        } satisfies TerminalFlowNodeDefinition,
      },
      recovery: { mode: "discard" },
      startNodeId: "publishFeedback",
      version: "1.0.0",
    });
    const parent = defineFlow({
      id: "test.feedback.parent",
      nodes: {
        child: defineSubflowNode(defineSubflowContract(child), {
          id: "child",
          mode: "sync",
          next: "done",
        }),
        done: {
          id: "done",
          kind: "terminal",
          output: { status: "completed" },
        } satisfies TerminalFlowNodeDefinition,
      },
      recovery: { mode: "discard" },
      startNodeId: "child",
      version: "1.0.0",
    });
    const feedback: UiFeedbackState[] = [];
    const engine = createFlowEngine();
    engine.register(child);
    engine.register(parent);

    const instance = await engine.start(parent.id, {}, {
      onUiFeedback: (value) => feedback.push(value),
    });
    await instance.completion;
    await engine.dispose();

    expect(feedback).toEqual([
      expect.objectContaining({
        safeData: { digitCount: 1, state: "changed" },
        status: "waiting",
      }),
    ]);
  });
});

