import type {
  EffectRunnerRegistry,
  FlowNodeExecutorRegistry,
} from "./registries";
import { runFlowHooks } from "./hooks";
import type {
  FlowExecutionContext,
  FlowHook,
  FlowInterrupt,
  FlowInterruptPolicy,
  FlowNodeDefinition,
  FlowNodeResult,
  FlowPolicies,
} from "./types";

export interface ExecuteFlowNodeOptions {
  readonly ctx: FlowExecutionContext;
  readonly node: FlowNodeDefinition;
  readonly hooks: readonly FlowHook[];
  readonly policies: FlowPolicies;
  readonly interrupt?: Promise<FlowInterrupt> | undefined;
}

export interface ExecuteFlowNodeOutcome {
  readonly result: FlowNodeResult;
  readonly interruptConsumed: boolean;
}

export class FlowNodeRuntime {
  public constructor(
    private readonly nodeExecutors: FlowNodeExecutorRegistry,
    private readonly effectRunners: EffectRunnerRegistry,
  ) {}

  public async execute(
    options: ExecuteFlowNodeOptions,
  ): Promise<ExecuteFlowNodeOutcome> {
    const { ctx, hooks, node } = options;
    const controller = linkedAbortController(ctx.signal);
    const nodeCtx = { ...ctx, signal: controller.signal };
    await runFlowHooks(hooks, "beforeNodeRun", nodeCtx, { nodeId: node.id });
    ctx.trace.record(traceEvent(ctx, node, "flow.node.started"));

    try {
      const outcome = await raceNodeExecution(
        this.nodeExecutors
          .requireExecutor(node.kind)
          .execute(nodeCtx, node),
        node.timeoutMs,
        options.interrupt,
      );
      if (outcome.type === "timeout") {
        controller.abort("node.timeout");
        await runFlowHooks(hooks, "onNodeTimeout", nodeCtx, {
          nodeId: node.id,
        });
        throw new FlowNodeTimeoutError(node.id, node.timeoutMs);
      }
      if (outcome.type === "interrupt") {
        controller.abort(outcome.interrupt.reasonCode);
        await runFlowHooks(hooks, "onFlowInterrupt", nodeCtx, {
          nodeId: node.id,
        });
        return {
          interruptConsumed: true,
          result: interruptResult(
            outcome.interrupt,
            options.policies,
            node,
          ),
        };
      }

      const result = await this.resolveEffects(nodeCtx, node, outcome.result);
      await runFlowHooks(hooks, "afterNodeRun", nodeCtx, {
        nodeId: node.id,
        result,
      });
      ctx.trace.record(
        traceEvent(ctx, node, "flow.node.completed", {
          resultType: result.type,
        }),
      );
      return { interruptConsumed: false, result };
    } catch (error) {
      await runFlowHooks(hooks, "onNodeError", nodeCtx, {
        error,
        nodeId: node.id,
      });
      throw error;
    }
  }

  private async resolveEffects(
    ctx: FlowExecutionContext,
    node: FlowNodeDefinition,
    result: FlowNodeResult,
  ): Promise<FlowNodeResult> {
    if (result.type !== "effects") {
      return result;
    }
    for (const effect of result.effects) {
      const next = await this.effectRunners
        .require(effect.kind)
        .run(ctx, effect);
      if (next) {
        return this.resolveEffects(ctx, node, next);
      }
    }
    return node.next
      ? { nodeId: node.next, type: "next" }
      : { type: "end" };
  }
}

export class FlowNodeTimeoutError extends Error {
  public constructor(
    readonly nodeId: string,
    readonly timeoutMs: number | undefined,
  ) {
    super(`Flow node timed out: ${nodeId}`);
    this.name = "FlowNodeTimeoutError";
  }
}

type NodeRaceOutcome =
  | { readonly type: "result"; readonly result: FlowNodeResult }
  | { readonly type: "timeout" }
  | { readonly type: "interrupt"; readonly interrupt: FlowInterrupt };

async function raceNodeExecution(
  execution: Promise<FlowNodeResult>,
  timeoutMs: number | undefined,
  interrupt: Promise<FlowInterrupt> | undefined,
): Promise<NodeRaceOutcome> {
  const races: Promise<NodeRaceOutcome>[] = [
    execution.then((result) => ({ result, type: "result" })),
  ];
  if (timeoutMs !== undefined) {
    races.push(
      new Promise((resolve) => {
        setTimeout(() => resolve({ type: "timeout" }), timeoutMs);
      }),
    );
  }
  if (interrupt) {
    races.push(
      interrupt.then((value) => ({
        interrupt: value,
        type: "interrupt",
      })),
    );
  }
  return Promise.race(races);
}

function interruptResult(
  interrupt: FlowInterrupt,
  policies: FlowPolicies,
  node: FlowNodeDefinition,
): FlowNodeResult {
  const policy = selectInterruptPolicy(interrupt, policies, node);
  if (policy?.action.type === "next") {
    return { nodeId: policy.action.nodeId, type: "next" };
  }
  if (policy?.action.type === "pause") {
    return {
      reasonCode: policy.action.reasonCode,
      type: "pause",
    };
  }
  return {
    metadata: { interruptId: interrupt.id },
    reasonCode:
      policy?.action.type === "cancelFlow"
        ? policy.action.reasonCode
        : interrupt.reasonCode,
    source: "interrupt",
    type: "cancel",
  };
}

function selectInterruptPolicy(
  interrupt: FlowInterrupt,
  policies: FlowPolicies,
  node: FlowNodeDefinition,
): FlowInterruptPolicy | undefined {
  return [...(policies.interrupts ?? [])]
    .filter(
      (policy) =>
        policy.id === interrupt.id &&
        (!policy.appliesTo ||
          policy.appliesTo === node.id ||
          policy.appliesTo === node.kind),
    )
    .sort((left, right) => right.priority - left.priority)[0];
}

function linkedAbortController(signal: AbortSignal | undefined): AbortController {
  const controller = new AbortController();
  if (signal?.aborted) {
    controller.abort(signal.reason);
  } else {
    signal?.addEventListener(
      "abort",
      () => controller.abort(signal.reason),
      { once: true },
    );
  }
  return controller;
}

function traceEvent(
  ctx: FlowExecutionContext,
  node: FlowNodeDefinition,
  type: string,
  summary?: Record<string, unknown>,
) {
  return {
    flowId: ctx.flowId,
    flowVersion: ctx.flowVersion,
    instanceId: ctx.instanceId,
    nodeId: node.id,
    summary,
    type,
  };
}
