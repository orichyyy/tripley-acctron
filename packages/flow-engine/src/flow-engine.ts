import {
  KioskError,
  ScopeDisposedError,
  type FlowDefinition,
  type FlowRunOptions,
  type FlowRunResult,
  type Logger,
  type RecoveryManager,
  type RecoveryReason,
  type StepContext,
  type StepResult,
  type TransactionResourceRegistry,
  type UiPort,
} from "@tripley-acctron/contracts";
import { compileFlow, type CompiledFlow } from "./compiler";
import { StepScopeImpl } from "./step-scope";
import type { StepRegistry } from "./step-registry";

export interface FlowEngineOptions {
  flows: FlowDefinition[];
  steps: StepRegistry;
  context: Omit<StepContext, "flowId" | "nodeId" | "scope" | "next" | "end">;
  ui?: UiPort;
  logger: Logger;
  recovery?: RecoveryManager;
  resources?: TransactionResourceRegistry;
}

export class FlowEngine {
  private readonly flows = new Map<string, CompiledFlow>();

  public constructor(private readonly options: FlowEngineOptions) {
    for (const flow of options.flows) {
      this.flows.set(flow.id, compileFlow(flow));
    }
  }

  public async run(flowId: string, options: FlowRunOptions = {}): Promise<FlowRunResult> {
    if (options.signal?.aborted) {
      await this.recover("cancel", options.signal.reason);
      throw cancellationError(options.signal.reason);
    }

    const flow = this.requireFlow(flowId);
    let nodeId = this.resolveNext(flow, flow.startNodeId, "default");

    for (;;) {
      const node = flow.nodes.get(nodeId);
      if (!node) {
        throw new KioskError("flow.compile", `Flow ${flowId} reached missing node ${nodeId}.`);
      }

      if (node.type === "end") {
        await this.recover("normalEnd");
        return { flowId, endName: node.name };
      }

      if (node.type === "shortcut") {
        nodeId = node.target;
        continue;
      }

      if (node.type !== "action") {
        throw new KioskError("flow.compile", `Unsupported executable node type ${node.type}.`);
      }

      const scope = new StepScopeImpl(this.options.context.events);
      const abort = () => {
        void scope.dispose().catch((error: unknown) => {
          this.options.logger.error("Flow scope disposal failed during cancellation.", {
            flowId,
            nodeId,
            error,
          });
        });
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      let result: StepResult;
      try {
        result = await this.executeAction(flow.id, node.id, node.action, node.config, scope);
      } catch (error) {
        await scope.dispose();
        options.signal?.removeEventListener("abort", abort);
        if (isCancellation(error, options.signal)) {
          await this.recover("cancel", error);
          throw cancellationError(error);
        }
        await this.recover("unhandledError", error);
        throw error;
      }
      if (options.signal?.aborted) {
        await scope.dispose();
        options.signal.removeEventListener("abort", abort);
        await this.recover("cancel", options.signal.reason);
        throw cancellationError(options.signal.reason);
      }
      await scope.dispose();
      options.signal?.removeEventListener("abort", abort);

      if (result.type === "end") {
        await this.recover("normalEnd");
        return { flowId, endName: result.name };
      }

      nodeId = this.resolveNext(flow, node.id, result.route);
    }
  }

  private async executeAction(
    flowId: string,
    nodeId: string,
    action: string,
    config: Record<string, unknown> | undefined,
    scope: StepScopeImpl,
  ): Promise<StepResult> {
    const step = this.options.steps.get(action);
    const ctx: StepContext = {
      ...this.options.context,
      flowId,
      nodeId,
      scope,
      next: (route) => ({ type: "next", route }),
      end: (name) => ({ type: "end", name }),
    };
    if (this.options.ui) {
      Object.assign(ctx, { ui: this.options.ui });
    }
    if (this.options.resources) {
      Object.assign(ctx, { resources: this.options.resources });
    }
    if (this.options.recovery) {
      Object.assign(ctx, { recovery: this.options.recovery });
    }

    try {
      return await step(ctx, config);
    } catch (error) {
      this.options.logger.error("Flow step failed.", { flowId, nodeId, action, error });
      throw error;
    }
  }

  private resolveNext(flow: CompiledFlow, from: string, route: string): string {
    const edges = flow.edgesByFrom.get(from) ?? [];
    const edge = edges.find((candidate) => (candidate.route ?? "default") === route) ?? edges[0];
    if (!edge) {
      throw new KioskError("flow.compile", `Flow ${flow.id} node ${from} has no route ${route}.`);
    }
    return edge.to;
  }

  private requireFlow(flowId: string): CompiledFlow {
    const flow = this.flows.get(flowId);
    if (!flow) {
      throw new KioskError("flow.compile", `Flow ${flowId} was not registered.`);
    }
    return flow;
  }

  private async recover(reason: RecoveryReason, error?: unknown): Promise<void> {
    const recovery = this.options.recovery ?? this.options.context.recovery;
    if (recovery) {
      await recovery.recover({ reason, error });
      return;
    }

    const resources = this.options.resources ?? this.options.context.resources;
    if (resources) {
      await resources.recover(reason);
      await resources.clear();
    }
  }
}

function isCancellation(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || error instanceof ScopeDisposedError;
}

function cancellationError(cause: unknown): KioskError {
  if (cause instanceof KioskError && cause.code === "transaction.cancelled") {
    return cause;
  }
  return new KioskError("transaction.cancelled", "Flow run was cancelled.", cause);
}
