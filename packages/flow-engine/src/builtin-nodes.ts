import type { FlowEngine } from "./engine-types";
import type {
  ActionFlowNodeDefinition,
  DecisionFlowNodeDefinition,
  FlowExecutionContext,
  FlowNodeDefinition,
  FlowNodeExecutor,
  FlowNodeResult,
  SubflowNodeDefinition,
  TerminalFlowNodeDefinition,
  WaitEventFlowNodeDefinition,
} from "./types";

export type {
  ActionFlowNodeDefinition,
  DecisionFlowNodeDefinition,
  TerminalFlowNodeDefinition,
  WaitEventFlowNodeDefinition,
} from "./types";

export class ActionNodeExecutor
  implements FlowNodeExecutor<ActionFlowNodeDefinition>
{
  public readonly kind = "action";

  public async execute(
    ctx: FlowExecutionContext,
    node: ActionFlowNodeDefinition,
  ): Promise<FlowNodeResult> {
    const value = await node.run(ctx);
    if (isFlowNodeResult(value)) {
      return value;
    }
    return node.next
      ? { nodeId: node.next, output: value, type: "next" }
      : { output: value, type: "end" };
  }
}

export class DecisionNodeExecutor
  implements FlowNodeExecutor<DecisionFlowNodeDefinition>
{
  public readonly kind = "decision";

  public async execute(
    ctx: FlowExecutionContext,
    node: DecisionFlowNodeDefinition,
  ): Promise<FlowNodeResult> {
    return { branch: await node.decide(ctx), type: "branch" };
  }
}

export class WaitEventNodeExecutor
  implements FlowNodeExecutor<WaitEventFlowNodeDefinition>
{
  public readonly kind = "waitEvent";

  public async execute(
    _ctx: FlowExecutionContext,
    node: WaitEventFlowNodeDefinition,
  ): Promise<FlowNodeResult> {
    return { type: "wait", waitFor: node.waitFor };
  }
}

export class TerminalNodeExecutor
  implements FlowNodeExecutor<TerminalFlowNodeDefinition>
{
  public readonly kind = "terminal";

  public async execute(
    ctx: FlowExecutionContext,
    node: TerminalFlowNodeDefinition,
  ): Promise<FlowNodeResult> {
    const output =
      typeof node.output === "function"
        ? await node.output(ctx)
        : (node.output ??
          ctx.scopedStore
            .scope("flow", ctx.instanceId)
            .get("lastOutput"));
    return { output, type: "end" };
  }
}

export class SubflowNodeExecutor
  implements FlowNodeExecutor<SubflowNodeDefinition>
{
  public readonly kind = "subflow";

  public constructor(private readonly engine: FlowEngine) {}

  public async execute(
    ctx: FlowExecutionContext,
    node: SubflowNodeDefinition,
  ): Promise<FlowNodeResult> {
    const input =
      typeof node.subflow.input === "function"
        ? await node.subflow.input(ctx)
        : node.subflow.input;
    const instance = await this.engine.start(
      node.subflow.flowId,
      input,
      {
        deviceLocks: ctx.deviceLocks,
        devices: ctx.devices,
        evaluateCondition: ctx.evaluateCondition,
        logger: ctx.logger,
        onUiFeedback: ctx.setUiFeedback,
        scopedStore: ctx.scopedStore,
        signal: ctx.signal,
        traceId: ctx.traceId,
        version: node.subflow.version,
      },
    );
    recordSubflowTrace(ctx, node, "flow.subflow.started", {
      childInstanceId: instance.instanceId,
      mode: node.subflow.mode,
    });
    if (node.subflow.mode === "async") {
      return nextOrEnd(node, { instanceId: instance.instanceId });
    }

    const snapshot = await instance.completion;
    recordSubflowTrace(ctx, node, "flow.subflow.completed", {
      childInstanceId: instance.instanceId,
      status: snapshot.status,
    });
    if (snapshot.status === "failed") {
      return {
        error:
          snapshot.result?.type === "fail"
            ? snapshot.result.error
            : new Error(`Subflow failed: ${node.subflow.flowId}`),
        type: "fail",
      };
    }
    if (snapshot.status === "cancelled") {
      return snapshot.result?.type === "cancel"
        ? snapshot.result
        : {
            reasonCode: "SUBFLOW.CANCELLED",
            source: "system",
            type: "cancel",
          };
    }
    if (node.subflow.outputKey) {
      ctx.scopedStore
        .scope("flow", ctx.instanceId)
        .set(node.subflow.outputKey, snapshot.output);
    }
    await node.subflow.acceptOutput?.(snapshot.output, ctx);
    return nextOrEnd(node, snapshot.output);
  }
}

function recordSubflowTrace(
  ctx: FlowExecutionContext,
  node: SubflowNodeDefinition,
  type: string,
  summary: Record<string, unknown>,
): void {
  ctx.trace.record({
    flowId: ctx.flowId,
    flowVersion: ctx.flowVersion,
    instanceId: ctx.instanceId,
    nodeId: node.id,
    summary: {
      childFlowId: node.subflow.flowId,
      childFlowVersion: node.subflow.version,
      ...summary,
    },
    type,
  });
}

function nextOrEnd(
  node: FlowNodeDefinition,
  output: unknown,
): FlowNodeResult {
  return node.next
    ? { nodeId: node.next, output, type: "next" }
    : { output, type: "end" };
}

function isFlowNodeResult(value: unknown): value is FlowNodeResult {
  if (!value || typeof value !== "object" || !("type" in value)) {
    return false;
  }
  return resultTypes.has(String(value.type));
}

const resultTypes = new Set([
  "next",
  "branch",
  "wait",
  "end",
  "fail",
  "cancel",
  "pause",
  "retry",
  "effects",
  "stay",
  "reenter",
]);
