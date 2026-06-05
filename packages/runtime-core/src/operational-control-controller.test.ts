import { describe, expect, test } from "vitest";
import type { FlowRunOptions, FlowRunResult } from "@tripley-acctron/contracts";
import { InMemoryCommandBus, InMemoryQueryBus } from "@tripley-acctron/event-bus";
import { InMemoryLogger } from "@tripley-acctron/observability";
import {
  type OperationalControlCommands,
  type OperationalControlQueries,
  registerOperationalControl,
} from "./operational-control-controller";
import {
  type TransactionLifecycleCommands,
  type TransactionLifecycleQueries,
  registerTransactionLifecycle,
} from "./transaction-controller";

type TestCommands = OperationalControlCommands & TransactionLifecycleCommands;
type TestQueries = OperationalControlQueries & TransactionLifecycleQueries;

describe("operational control controller", () => {
  test("immediate suspend cancels running transaction and blocks new starts", async () => {
    const kit = createOperationalKit({
      run: (flowId, options) => rejectOnAbort(flowId, options),
    });

    const start = kit.commands.execute("transaction.start", { flowId: "demo" });
    await flushPromises();

    await expect(
      kit.commands.execute("service.applyHostCommand", {
        traceId: "trace-1",
        command: { type: "suspendService", mode: "immediate", reason: "host" },
      }),
    ).resolves.toMatchObject({ state: "suspended", reason: "host" });
    await expect(start).resolves.toMatchObject({ state: "cancelled" });
    await expect(
      kit.commands.execute("transaction.start", { flowId: "demo" }),
    ).rejects.toMatchObject({ code: "service.suspended" });
  });

  test("after-current suspend waits for running transaction to settle", async () => {
    const finished = deferred<FlowRunResult>();
    const kit = createOperationalKit({
      run: () => finished.promise,
    });

    const start = kit.commands.execute("transaction.start", { flowId: "demo" });
    await flushPromises();

    await expect(
      kit.commands.execute("service.applyHostCommand", {
        traceId: "trace-2",
        command: { type: "suspendService", mode: "afterCurrentTransaction" },
      }),
    ).resolves.toMatchObject({ state: "suspending", pendingSuspend: true });

    finished.resolve({ flowId: "demo", endName: "Success" });
    await expect(start).resolves.toMatchObject({ state: "completed" });
    await expect(kit.queries.query("service.status", {})).resolves.toMatchObject({
      state: "suspended",
      pendingSuspend: false,
    });
  });

  test("maintenance cancels running transaction and exit restores online service", async () => {
    const kit = createOperationalKit({
      run: (flowId, options) => rejectOnAbort(flowId, options),
    });

    const start = kit.commands.execute("transaction.start", { flowId: "demo" });
    await flushPromises();

    await expect(
      kit.commands.execute("service.applyHostCommand", {
        traceId: "trace-3",
        command: { type: "enterMaintenance", reason: "cash replenish" },
      }),
    ).resolves.toMatchObject({ state: "maintenance", reason: "cash replenish" });
    await expect(start).resolves.toMatchObject({ state: "cancelled" });
    await expect(
      kit.commands.execute("transaction.start", { flowId: "demo" }),
    ).rejects.toMatchObject({ code: "service.maintenance" });

    await expect(
      kit.commands.execute("service.applyHostCommand", {
        traceId: "trace-4",
        command: { type: "exitMaintenance" },
      }),
    ).resolves.toMatchObject({ state: "online" });
  });
});

interface OperationalKitOptions {
  run(flowId: string, options?: FlowRunOptions): Promise<FlowRunResult>;
}

function createOperationalKit(options: OperationalKitOptions) {
  const commands = new InMemoryCommandBus<TestCommands>();
  const queries = new InMemoryQueryBus<TestQueries>();
  const logger = new InMemoryLogger();
  const operational = registerOperationalControl({ commands, queries, logger });
  const transaction = registerTransactionLifecycle({
    commands,
    queries,
    flow: { run: options.run },
    logger,
    hooks: {
      beforeStartGuard: (request) => operational.beforeTransactionStart(request),
      afterComplete: (status) => operational.afterTransactionSettled(status),
      afterFailed: (status) => operational.afterTransactionSettled(status),
      afterCancelled: (status) => operational.afterTransactionSettled(status),
    },
  });
  return { commands, queries, operational, transaction };
}

function rejectOnAbort(
  flowId: string,
  options: FlowRunOptions | undefined,
): Promise<FlowRunResult> {
  return new Promise((_resolve, reject) => {
    if (options?.signal?.aborted) {
      reject(options.signal.reason);
      return;
    }
    options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
      once: true,
    });
    void flowId;
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function flushPromises(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}
