import { describe, expect, test } from "vitest";
import { InMemoryCommandBus, InMemoryEventBus, InMemoryQueryBus } from "@tripley-acctron/event-bus";
import { InMemoryLogger } from "@tripley-acctron/observability";
import type { KioskEvents } from "@tripley-acctron/contracts";
import { compileFlow } from "./compiler";
import { FlowEngine } from "./flow-engine";
import { StepRegistry } from "./step-registry";
import { StepScopeImpl } from "./step-scope";

declare module "@tripley-acctron/contracts" {
  interface KioskEvents {
    "demo.ready": { value: string };
  }
}

describe("flow engine", () => {
  test("compile fails without start", () => {
    expect(() => compileFlow({ id: "bad", version: "1", nodes: [], edges: [] })).toThrow();
  });

  test("runs start action end flow", async () => {
    const logger = new InMemoryLogger();
    const engine = new FlowEngine({
      logger,
      flows: [
        {
          id: "demo",
          version: "1",
          nodes: [
            { id: "start", type: "start" },
            { id: "input", type: "action", action: "input" },
            { id: "success", type: "end", name: "Success" },
          ],
          edges: [
            { id: "e1", from: "start", to: "input" },
            { id: "e2", from: "input", to: "success", route: "ok" },
          ],
        },
      ],
      steps: StepRegistry.fromRecord({
        input: (ctx) => ctx.next("ok"),
      }),
      context: {
        events: new InMemoryEventBus<KioskEvents>(),
        commands: new InMemoryCommandBus(),
        queries: new InMemoryQueryBus(),
        logger,
      },
    });

    await expect(engine.run("demo")).resolves.toEqual({ flowId: "demo", endName: "Success" });
  });

  test("step scope cleans up and aborts", async () => {
    const events = new InMemoryEventBus<KioskEvents>();
    const scope = new StepScopeImpl(events);
    let cleaned = false;

    scope.onDispose(() => {
      cleaned = true;
    });
    await scope.dispose();

    expect(cleaned).toBe(true);
    expect(scope.signal.aborted).toBe(true);
  });
});
