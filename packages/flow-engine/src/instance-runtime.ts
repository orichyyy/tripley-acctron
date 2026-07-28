import type {
  DeviceLockManager,
  DeviceRegistry,
} from "@tripley-kit/web-container-device-core";
import { FrameworkError } from "@tripley-kit/web-container-errors";
import type { LoggerPort } from "@tripley-kit/web-container-logging";
import type { ScopedStore } from "@tripley-kit/web-container-scoped-store";

import type {
  FlowCancellationReason,
  FlowInstance,
  FlowProjectionPort,
} from "./engine-types";
import { runFlowHooks } from "./hooks";
import type { FlowNodeRuntime } from "./node-runtime";
import type {
  FlowDefinition,
  FlowExecutionContext,
  FlowHook,
  FlowInstanceSnapshot,
  FlowInterrupt,
  FlowNodeDefinition,
  FlowNodeResult,
  FlowPolicies,
  FlowTraceEvent,
  UiFeedbackState,
} from "./types";

export interface FlowInstanceRuntimeOptions<Output> {
  readonly definition: FlowDefinition<unknown, Output>;
  readonly input: unknown;
  readonly instanceId: string;
  readonly traceId?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly interrupt?: Promise<FlowInterrupt> | undefined;
  readonly devices: DeviceRegistry;
  readonly deviceLocks: DeviceLockManager;
  readonly scopedStore: ScopedStore;
  readonly logger?: LoggerPort | undefined;
  readonly policies: FlowPolicies;
  readonly hooks: readonly FlowHook[];
  readonly projection?: FlowProjectionPort | undefined;
  readonly nodeRuntime: FlowNodeRuntime;
  readonly stopOn: ReadonlySet<"stay" | "reenter">;
  readonly evaluateCondition?:
    | ((conditionId: string) => boolean | Promise<boolean>)
    | undefined;
  readonly onUiFeedback?:
    | ((feedback: UiFeedbackState) => void)
    | undefined;
}

export class FlowInstanceRuntime<Output = unknown>
  implements FlowInstance<Output>
{
  public readonly flowId: string;
  public readonly flowVersion: string;
  public readonly completion: Promise<FlowInstanceSnapshot<Output>>;
  private readonly completionDeferred =
    deferred<FlowInstanceSnapshot<Output>>();
  private readonly controller = new AbortController();
  private readonly path: string[] = [];
  private readonly trace: FlowTraceEvent[] = [];
  private readonly uiFeedback: UiFeedbackState[] = [];
  private readonly retries = new Map<string, number>();
  private currentNodeId: string | undefined;
  private status: FlowInstanceSnapshot["status"] = "running";
  private result: FlowNodeResult | undefined;
  private output: Output | undefined;
  private cancellation: FlowCancellationReason | undefined;
  private pauseRequested: string | undefined;
  private resumeGate: ReturnType<typeof deferred<unknown>> | undefined;
  private interruptConsumed = false;
  private flowTimer: ReturnType<typeof setTimeout> | undefined;
  private started = false;

  public constructor(
    public readonly instanceId: string,
    private readonly options: FlowInstanceRuntimeOptions<Output>,
  ) {
    this.flowId = options.definition.id;
    this.flowVersion = options.definition.version;
    this.currentNodeId = options.definition.startNodeId;
    this.completion = this.completionDeferred.promise;
  }

  public start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.linkExternalCancellation();
    if (this.options.definition.timeoutMs !== undefined) {
      this.flowTimer = setTimeout(
        () =>
          this.requestCancellation({
            reasonCode: "FLOW.TIMEOUT",
            source: "timeout",
          }),
        this.options.definition.timeoutMs,
      );
    }
    void this.run();
  }

  public snapshot(): FlowInstanceSnapshot<Output> {
    return {
      currentNodeId: this.currentNodeId,
      flowId: this.flowId,
      flowVersion: this.flowVersion,
      instanceId: this.instanceId,
      output: this.output,
      path: [...this.path],
      result: this.result,
      status: this.status,
      trace: [...this.trace],
      uiFeedback: [...this.uiFeedback],
    };
  }

  public async cancel(reason: FlowCancellationReason): Promise<void> {
    this.requestCancellation(reason);
    await this.completion;
  }

  public async pause(reason = "FLOW.PAUSED"): Promise<void> {
    if (this.status !== "running") {
      return;
    }
    this.pauseRequested = reason;
  }

  public async resume(input?: unknown): Promise<void> {
    if (!this.resumeGate) {
      throw new FrameworkError({
        category: "configuration",
        code: "flow.instance.notPaused",
        message: `Flow instance is not paused: ${this.instanceId}`,
      });
    }
    this.options.scopedStore
      .scope("flow", this.instanceId)
      .set("resumeInput", input);
    this.resumeGate.resolve(input);
  }

  private async run(): Promise<void> {
    const baseContext = this.context(
      this.currentNodeId ?? this.options.definition.startNodeId,
      this.controller.signal,
    );
    try {
      await runFlowHooks(this.options.hooks, "beforeFlowStart", baseContext, {});
      this.record("flow.started");
      await this.publish();
      await runFlowHooks(this.options.hooks, "afterFlowStart", baseContext, {});
      await this.runNodes();
    } catch (error) {
      await this.complete(
        "failed",
        { error, type: "fail" },
        baseContext,
      );
    } finally {
      try {
        await this.options.definition.finally?.(baseContext);
        await runFlowHooks(
          this.options.hooks,
          "onFlowFinally",
          baseContext,
          { result: this.result },
        );
      } catch (error) {
        if (this.status === "running" || this.status === "paused") {
          await this.complete(
            "failed",
            { error, type: "fail" },
            baseContext,
          );
        }
      }
      if (this.flowTimer) {
        clearTimeout(this.flowTimer);
      }
      this.completionDeferred.resolve(this.snapshot());
    }
  }

  private async runNodes(): Promise<void> {
    while (this.status === "running") {
      if (this.cancellation) {
        await this.completeCancellation();
        return;
      }
      if (this.pauseRequested) {
        await this.suspend({
          reasonCode: this.pauseRequested,
          type: "pause",
        });
        this.pauseRequested = undefined;
        continue;
      }

      const node = this.requireCurrentNode();
      this.path.push(node.id);
      await this.publish();
      const ctx = this.context(node.id, this.controller.signal);
      let result: FlowNodeResult;
      try {
        const outcome = await this.options.nodeRuntime.execute({
          ctx,
          hooks: this.options.hooks,
          interrupt: this.interruptConsumed
            ? undefined
            : this.options.interrupt,
          node,
          policies: this.options.policies,
        });
        this.interruptConsumed ||= outcome.interruptConsumed;
        result = this.cancellation
          ? cancellationResult(this.cancellation)
          : outcome.result;
      } catch (error) {
        result = this.options.definition.catch
          ? await this.options.definition.catch(ctx, error)
          : { error, type: "fail" };
      }
      if (await this.transition(node, result, ctx)) {
        return;
      }
    }
  }

  private async transition(
    node: FlowNodeDefinition,
    result: FlowNodeResult,
    ctx: FlowExecutionContext,
  ): Promise<boolean> {
    this.result = result;
    storeNodeOutput(this.options.scopedStore, this.instanceId, node, result);

    if (result.type === "next") {
      this.currentNodeId = result.nodeId;
      return false;
    }
    if (result.type === "branch") {
      this.currentNodeId = this.resolveBranch(node.id, result.branch);
      return false;
    }
    if (result.type === "stay" || result.type === "reenter") {
      if (this.options.stopOn.has(result.type)) {
        await this.publish();
        return true;
      }
      this.currentNodeId = result.nodeId;
      return false;
    }
    if (result.type === "retry") {
      return this.retry(node, result, ctx);
    }
    if (result.type === "wait" || result.type === "pause") {
      await this.suspend(result);
      this.currentNodeId =
        result.type === "wait" ? (node.next ?? node.id) : node.id;
      return false;
    }
    if (result.type === "end") {
      const output = this.options.definition.outputSchema
        ? await this.options.definition.outputSchema.validate(result.output)
        : result.output;
      this.output = output as Output;
      await this.complete("completed", result, ctx);
      return true;
    }
    if (result.type === "cancel") {
      await this.complete("cancelled", result, ctx);
      return true;
    }
    if (result.type === "fail") {
      await this.complete("failed", result, ctx);
      return true;
    }
    return false;
  }

  private async retry(
    node: FlowNodeDefinition,
    result: Extract<FlowNodeResult, { type: "retry" }>,
    ctx: FlowExecutionContext,
  ): Promise<boolean> {
    const attempt = (this.retries.get(node.id) ?? 1) + 1;
    this.retries.set(node.id, attempt);
    if (attempt > (this.options.definition.retry?.maxAttempts ?? 1)) {
      await this.complete(
        "failed",
        {
          error: new Error(
            `Flow node retry limit exceeded: ${node.id} (${result.reasonCode})`,
          ),
          type: "fail",
        },
        ctx,
      );
      return true;
    }
    if (this.options.definition.retry?.backoffMs) {
      await delay(this.options.definition.retry.backoffMs);
    }
    this.currentNodeId = node.id;
    return false;
  }

  private async suspend(
    result: Extract<FlowNodeResult, { type: "wait" | "pause" }>,
  ): Promise<void> {
    this.result = result;
    this.status = "paused";
    this.resumeGate = deferred<unknown>();
    await this.publish();
    await this.resumeGate.promise;
    this.resumeGate = undefined;
    if (this.cancellation) {
      return;
    }
    this.status = "running";
    await this.publish();
  }

  private async complete(
    status: Extract<
      FlowInstanceSnapshot["status"],
      "completed" | "failed" | "cancelled"
    >,
    result: FlowNodeResult,
    ctx: FlowExecutionContext,
  ): Promise<void> {
    this.status = status;
    this.result = result;
    this.record(`flow.${status}`, {
      resultType: result.type,
    });
    const hookName =
      status === "completed"
        ? "onFlowComplete"
        : status === "cancelled"
          ? "onFlowCancel"
          : "onFlowFail";
    await runFlowHooks(this.options.hooks, hookName, ctx, { result });
    await this.publish();
  }

  private async completeCancellation(): Promise<void> {
    const ctx = this.context(
      this.currentNodeId ?? this.options.definition.startNodeId,
      this.controller.signal,
    );
    await this.complete(
      "cancelled",
      cancellationResult(this.cancellation!),
      ctx,
    );
  }

  private context(
    nodeId: string,
    signal: AbortSignal,
  ): FlowExecutionContext {
    return {
      definition: this.options.definition,
      deviceLocks: this.options.deviceLocks,
      devices: this.options.devices,
      evaluateCondition: this.options.evaluateCondition,
      flowId: this.flowId,
      flowVersion: this.flowVersion,
      input: this.options.input,
      instanceId: this.instanceId,
      interrupt: this.interruptConsumed
        ? undefined
        : this.options.interrupt,
      logger: this.options.logger,
      nodeId,
      policies: this.options.policies,
      scopedStore: this.options.scopedStore,
      setUiFeedback: (feedback) => {
        this.uiFeedback.push(feedback);
        this.options.onUiFeedback?.(feedback);
        void this.publish();
      },
      signal,
      trace: { record: (event) => this.trace.push(event) },
      traceId: this.options.traceId,
    };
  }

  private requireCurrentNode(): FlowNodeDefinition {
    const node = this.currentNodeId
      ? this.options.definition.nodes[this.currentNodeId]
      : undefined;
    if (!node) {
      throw new FrameworkError({
        category: "configuration",
        code: "flow.node.missing",
        message: `Flow node is missing: ${this.currentNodeId ?? "undefined"}`,
        metadata: {
          flowId: this.flowId,
          flowVersion: this.flowVersion,
          ...(this.currentNodeId === undefined
            ? {}
            : { nodeId: this.currentNodeId }),
        },
      });
    }
    return node;
  }

  private resolveBranch(nodeId: string, branch: string): string {
    const target = this.options.definition.edges?.find(
      (edge) => edge.from === nodeId && edge.branch === branch,
    )?.to;
    if (!target) {
      throw new FrameworkError({
        category: "configuration",
        code: "flow.branch.missing",
        message: `Flow branch is not configured: ${nodeId}.${branch}`,
      });
    }
    return target;
  }

  private requestCancellation(reason: FlowCancellationReason): void {
    if (this.status !== "running" && this.status !== "paused") {
      return;
    }
    this.cancellation = reason;
    this.controller.abort(reason.reasonCode);
    this.resumeGate?.resolve(undefined);
  }

  private linkExternalCancellation(): void {
    const signal = this.options.signal;
    if (signal?.aborted) {
      this.requestCancellation({
        metadata: { reason: signal.reason },
        reasonCode: "FLOW.ABORTED",
        source: "system",
      });
      return;
    }
    signal?.addEventListener(
      "abort",
      () =>
        this.requestCancellation({
          metadata: { reason: signal.reason },
          reasonCode: "FLOW.ABORTED",
          source: "system",
        }),
      { once: true },
    );
  }

  private record(
    type: string,
    summary?: Record<string, unknown>,
  ): void {
    this.trace.push({
      flowId: this.flowId,
      flowVersion: this.flowVersion,
      instanceId: this.instanceId,
      nodeId: this.currentNodeId,
      summary,
      type,
    });
  }

  private async publish(): Promise<void> {
    await this.options.projection?.publish(this.snapshot());
  }
}

function cancellationResult(
  reason: FlowCancellationReason,
): Extract<FlowNodeResult, { type: "cancel" }> {
  return {
    metadata: reason.metadata,
    reasonCode: reason.reasonCode,
    source: reason.source,
    type: "cancel",
  };
}

function storeNodeOutput(
  store: ScopedStore,
  instanceId: string,
  node: FlowNodeDefinition,
  result: FlowNodeResult,
): void {
  if (!("output" in result) || result.output === undefined) {
    return;
  }
  const scope = store.scope("flow", instanceId);
  scope.set(`node.${node.id}.output`, result.output);
  scope.set("lastOutput", result.output);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
