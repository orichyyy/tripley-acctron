import { describe, expect, test, vi } from "vitest";
import type {
  FlowRunOptions,
  FlowRunResult,
  TransactionDataStore,
} from "@tripley-acctron/contracts";
import { InMemoryCommandBus, InMemoryQueryBus } from "@tripley-acctron/event-bus";
import { InMemoryLogger } from "@tripley-acctron/observability";
import {
  type TransactionLifecycleCommands,
  type TransactionLifecycleQueries,
  registerTransactionLifecycle,
} from "./transaction-controller";

describe("transaction lifecycle controller", () => {
  test("start runs a flow and updates completed status", async () => {
    const kit = createControllerKit({
      run: async (flowId) => ({ flowId, endName: "Success" }),
    });

    await expect(
      kit.commands.execute("transaction.start", { flowId: "demo" }),
    ).resolves.toMatchObject({
      state: "completed",
      result: { flowId: "demo", endName: "Success" },
    });
    await expect(kit.queries.query("transaction.status", {})).resolves.toMatchObject({
      state: "completed",
    });
  });

  test("duplicate start fails while a transaction is running", async () => {
    const running = deferred<FlowRunResult>();
    const started = deferred<void>();
    const kit = createControllerKit({
      run: (flowId) => {
        started.resolve();
        return running.promise.then(() => ({ flowId, endName: "Success" }));
      },
    });

    const start = kit.commands.execute("transaction.start", { flowId: "demo" });
    await started.promise;
    await expect(
      kit.commands.execute("transaction.start", { flowId: "demo" }),
    ).rejects.toMatchObject({ code: "transaction.running" });

    running.resolve({ flowId: "demo", endName: "Success" });
    await expect(start).resolves.toMatchObject({ state: "completed" });
  });

  test("cancel aborts the active flow and returns cancelled status", async () => {
    const started = deferred<void>();
    const kit = createControllerKit({
      run: (flowId, options) => {
        started.resolve();
        return rejectOnAbort(flowId, options);
      },
    });

    const start = kit.commands.execute("transaction.start", { flowId: "demo" });
    await started.promise;

    await expect(kit.commands.execute("transaction.cancel", {})).resolves.toMatchObject({
      state: "cancelled",
      flowId: "demo",
    });
    await expect(start).resolves.toMatchObject({ state: "cancelled" });
  });

  test("reset cancels active flow, clears transaction data, and closes dialogs", async () => {
    const started = deferred<void>();
    const closeDialog = vi.fn(async () => {});
    const transaction = new FakeTransactionDataStore();
    const kit = createControllerKit({
      transaction,
      ui: { closeDialog },
      run: (flowId, options) => {
        started.resolve();
        return rejectOnAbort(flowId, options);
      },
    });
    transaction.set("accountNo", "123456");

    const start = kit.commands.execute("transaction.start", { flowId: "demo" });
    await started.promise;

    await expect(kit.commands.execute("transaction.reset", {})).resolves.toMatchObject({
      state: "idle",
    });
    await expect(start).resolves.toMatchObject({ state: "cancelled" });
    expect(transaction.snapshot()).toEqual({});
    expect(closeDialog).toHaveBeenCalledWith();
  });
});

interface ControllerKitOptions {
  run(flowId: string, options?: FlowRunOptions): Promise<FlowRunResult>;
  transaction?: TransactionDataStore;
  ui?: { closeDialog(): Promise<void> };
}

function createControllerKit(options: ControllerKitOptions) {
  const commands = new InMemoryCommandBus<TransactionLifecycleCommands>();
  const queries = new InMemoryQueryBus<TransactionLifecycleQueries>();
  const controller = registerTransactionLifecycle({
    commands,
    queries,
    flow: { run: options.run },
    logger: new InMemoryLogger(),
    ...(options.transaction ? { transaction: options.transaction } : {}),
    ...(options.ui ? { ui: options.ui } : {}),
  });
  return { commands, queries, controller };
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

class FakeTransactionDataStore implements TransactionDataStore {
  private readonly data = new Map<string, unknown>();

  public get<T = unknown>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }

  public set<T = unknown>(key: string, value: T): void {
    this.data.set(key, value);
  }

  public has(key: string): boolean {
    return this.data.has(key);
  }

  public delete(key: string): boolean {
    return this.data.delete(key);
  }

  public clear(): void {
    this.data.clear();
  }

  public snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.data);
  }
}
