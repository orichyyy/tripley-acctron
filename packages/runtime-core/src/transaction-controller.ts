import {
  KioskError,
  type CommandDef,
  type Disposable,
  type FlowRunner,
  type Logger,
  type QueryDef,
  type TransactionCancelRequest,
  type TransactionDataStore,
  type TransactionLifecycleStatus,
  type TransactionResetRequest,
  type TransactionStartRequest,
  type TypedCommandBus,
  type TypedQueryBus,
  type UiPort,
} from "@tripley-acctron/contracts";

export interface TransactionLifecycleControllerOptions {
  commands: TypedCommandBus<TransactionLifecycleCommands>;
  queries: TypedQueryBus<TransactionLifecycleQueries>;
  flow: FlowRunner;
  logger: Logger;
  transaction?: TransactionDataStore;
  ui?: Pick<UiPort, "closeDialog">;
  hooks?: TransactionLifecycleHooks;
}

export interface TransactionLifecycleCommands {
  "transaction.start": CommandDef<TransactionStartRequest, TransactionLifecycleStatus>;
  "transaction.cancel": CommandDef<TransactionCancelRequest, TransactionLifecycleStatus>;
  "transaction.reset": CommandDef<TransactionResetRequest, TransactionLifecycleStatus>;
}

export interface TransactionLifecycleQueries {
  "transaction.status": QueryDef<Record<never, never>, TransactionLifecycleStatus>;
}

export interface TransactionLifecycleHooks {
  beforeStartGuard?(request: TransactionStartRequest): Promise<void> | void;
  beforeStart?(request: TransactionStartRequest): Promise<void> | void;
  afterComplete?(status: TransactionLifecycleStatus): Promise<void> | void;
  afterFailed?(status: TransactionLifecycleStatus, error: unknown): Promise<void> | void;
  afterCancelled?(status: TransactionLifecycleStatus): Promise<void> | void;
  afterReset?(request: TransactionResetRequest): Promise<void> | void;
}

interface ActiveTransaction {
  flowId: string;
  abort: AbortController;
  completion: Promise<TransactionLifecycleStatus>;
}

export class TransactionLifecycleController implements Disposable {
  private readonly disposables: Disposable[];
  private active: ActiveTransaction | undefined;
  private status: TransactionLifecycleStatus = { state: "idle" };

  public constructor(private readonly options: TransactionLifecycleControllerOptions) {
    this.disposables = [
      options.commands.handle("transaction.start", (request) => this.start(request)),
      options.commands.handle("transaction.cancel", (request) => this.cancel(request)),
      options.commands.handle("transaction.reset", (request) => this.reset(request)),
      options.queries.handle("transaction.status", () => this.getStatus()),
    ];
  }

  public async dispose(): Promise<void> {
    await this.cancel({ reason: "dispose" });
    for (const disposable of this.disposables.reverse()) {
      await disposable.dispose();
    }
  }

  public getStatus(): TransactionLifecycleStatus {
    return { ...this.status };
  }

  private async start(request: TransactionStartRequest): Promise<TransactionLifecycleStatus> {
    if (this.active) {
      throw new KioskError(
        "transaction.running",
        `Transaction flow ${this.active.flowId} is already running.`,
      );
    }

    await this.options.hooks?.beforeStartGuard?.(request);
    this.options.transaction?.clear();
    await this.options.hooks?.beforeStart?.(request);

    const abort = new AbortController();
    const completion = this.runTransaction(request, abort);
    this.active = { flowId: request.flowId, abort, completion };
    this.status = {
      state: "running",
      flowId: request.flowId,
      ...(request.metadata ? { metadata: request.metadata } : {}),
    };
    return await completion;
  }

  private async cancel(_request: TransactionCancelRequest): Promise<TransactionLifecycleStatus> {
    const active = this.active;
    if (!active) {
      return this.getStatus();
    }

    active.abort.abort(new KioskError("transaction.cancelled", "Transaction was cancelled."));
    return await active.completion;
  }

  private async reset(request: TransactionResetRequest): Promise<TransactionLifecycleStatus> {
    if (this.active) {
      await this.cancel({ reason: "reset" });
    }

    this.options.transaction?.clear();
    await this.options.ui?.closeDialog();
    this.status = {
      state: "idle",
      ...(request.metadata ? { metadata: request.metadata } : {}),
    };
    await this.options.hooks?.afterReset?.(request);
    return this.getStatus();
  }

  private async runTransaction(
    request: TransactionStartRequest,
    abort: AbortController,
  ): Promise<TransactionLifecycleStatus> {
    try {
      const result = await this.options.flow.run(request.flowId, { signal: abort.signal });
      this.status = {
        state: "completed",
        flowId: request.flowId,
        result,
        ...(request.metadata ? { metadata: request.metadata } : {}),
      };
      await this.options.hooks?.afterComplete?.(this.status);
      return this.getStatus();
    } catch (error) {
      if (abort.signal.aborted) {
        this.status = {
          state: "cancelled",
          flowId: request.flowId,
          ...(request.metadata ? { metadata: request.metadata } : {}),
        };
        this.options.logger.info("Transaction cancelled.", { flowId: request.flowId });
        await this.options.hooks?.afterCancelled?.(this.status);
        return this.getStatus();
      }

      this.status = {
        state: "failed",
        flowId: request.flowId,
        errorMessage: errorMessage(error),
        ...(request.metadata ? { metadata: request.metadata } : {}),
      };
      this.options.logger.error("Transaction failed.", { flowId: request.flowId, error });
      await this.options.hooks?.afterFailed?.(this.status, error);
      return this.getStatus();
    } finally {
      this.active = undefined;
    }
  }
}

export function registerTransactionLifecycle(
  options: TransactionLifecycleControllerOptions,
): TransactionLifecycleController {
  return new TransactionLifecycleController(options);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
