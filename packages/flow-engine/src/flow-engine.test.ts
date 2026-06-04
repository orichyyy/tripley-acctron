import { describe, expect, test, vi } from "vitest";
import { InMemoryCommandBus, InMemoryEventBus, InMemoryQueryBus } from "@tripley-acctron/event-bus";
import { InMemoryLogger } from "@tripley-acctron/observability";
import type { KioskEvents, RecoveryManager } from "@tripley-acctron/contracts";
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

  test("unhandled step errors trigger recovery", async () => {
    const logger = new InMemoryLogger();
    const error = new Error("boom");
    const recovery: RecoveryManager = {
      recover: vi.fn(async () => {}),
    };
    const engine = new FlowEngine({
      logger,
      recovery,
      flows: [
        {
          id: "demo",
          version: "1",
          nodes: [
            { id: "start", type: "start" },
            { id: "fail", type: "action", action: "fail" },
            { id: "done", type: "end", name: "Done" },
          ],
          edges: [
            { id: "e1", from: "start", to: "fail" },
            { id: "e2", from: "fail", to: "done" },
          ],
        },
      ],
      steps: StepRegistry.fromRecord({
        fail: () => {
          throw error;
        },
      }),
      context: {
        events: new InMemoryEventBus<KioskEvents>(),
        commands: new InMemoryCommandBus(),
        queries: new InMemoryQueryBus(),
        logger,
      },
    });

    await expect(engine.run("demo")).rejects.toBe(error);
    expect(recovery.recover).toHaveBeenCalledWith({ reason: "unhandledError", error });
  });

  test("normal flow end triggers normalEnd recovery", async () => {
    const logger = new InMemoryLogger();
    const recovery: RecoveryManager = {
      recover: vi.fn(async () => {}),
    };
    const engine = new FlowEngine({
      logger,
      recovery,
      flows: [
        {
          id: "demo",
          version: "1",
          nodes: [
            { id: "start", type: "start" },
            { id: "finish", type: "action", action: "finish" },
          ],
          edges: [{ id: "e1", from: "start", to: "finish" }],
        },
      ],
      steps: StepRegistry.fromRecord({
        finish: (ctx) => ctx.end("Done"),
      }),
      context: {
        events: new InMemoryEventBus<KioskEvents>(),
        commands: new InMemoryCommandBus(),
        queries: new InMemoryQueryBus(),
        logger,
      },
    });

    await expect(engine.run("demo")).resolves.toEqual({ flowId: "demo", endName: "Done" });
    expect(recovery.recover).toHaveBeenCalledWith({ reason: "normalEnd", error: undefined });
  });

  test("graph end nodes trigger normalEnd recovery", async () => {
    const logger = new InMemoryLogger();
    const recovery: RecoveryManager = {
      recover: vi.fn(async () => {}),
    };
    const engine = new FlowEngine({
      logger,
      recovery,
      flows: [
        {
          id: "demo",
          version: "1",
          nodes: [
            { id: "start", type: "start" },
            { id: "input", type: "action", action: "input" },
            { id: "done", type: "end", name: "Done" },
          ],
          edges: [
            { id: "e1", from: "start", to: "input" },
            { id: "e2", from: "input", to: "done", route: "ok" },
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

    await expect(engine.run("demo")).resolves.toEqual({ flowId: "demo", endName: "Done" });
    expect(recovery.recover).toHaveBeenCalledWith({ reason: "normalEnd", error: undefined });
  });

  test("external abort disposes active step and recovers as cancel", async () => {
    const logger = new InMemoryLogger();
    const abort = new AbortController();
    const recovery: RecoveryManager = {
      recover: vi.fn(async () => {}),
    };
    let releaseStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      releaseStarted = resolve;
    });
    const engine = new FlowEngine({
      logger,
      recovery,
      flows: [
        {
          id: "demo",
          version: "1",
          nodes: [
            { id: "start", type: "start" },
            { id: "wait", type: "action", action: "wait" },
            { id: "done", type: "end", name: "Done" },
          ],
          edges: [
            { id: "e1", from: "start", to: "wait" },
            { id: "e2", from: "wait", to: "done", route: "ok" },
          ],
        },
      ],
      steps: StepRegistry.fromRecord({
        async wait(ctx) {
          releaseStarted?.();
          await ctx.scope.waitEvent("demo.ready");
          return ctx.next("ok");
        },
      }),
      context: {
        events: new InMemoryEventBus<KioskEvents>(),
        commands: new InMemoryCommandBus(),
        queries: new InMemoryQueryBus(),
        logger,
      },
    });

    const run = engine.run("demo", { signal: abort.signal });
    await started;
    abort.abort();

    await expect(run).rejects.toMatchObject({ code: "transaction.cancelled" });
    expect(recovery.recover).toHaveBeenCalledWith(expect.objectContaining({ reason: "cancel" }));
  });
});
