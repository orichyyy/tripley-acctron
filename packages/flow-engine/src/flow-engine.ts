import {
  KioskError,
  type FlowDefinition,
  type FlowRunResult,
  type Logger,
  type StepContext,
  type StepResult,
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
}

export class FlowEngine {
  private readonly flows = new Map<string, CompiledFlow>();

  public constructor(private readonly options: FlowEngineOptions) {
    for (const flow of options.flows) {
      this.flows.set(flow.id, compileFlow(flow));
    }
  }

  public async run(flowId: string): Promise<FlowRunResult> {
    const flow = this.requireFlow(flowId);
    let nodeId = this.resolveNext(flow, flow.startNodeId, "default");

    for (;;) {
      const node = flow.nodes.get(nodeId);
      if (!node) {
        throw new KioskError("flow.compile", `Flow ${flowId} reached missing node ${nodeId}.`);
      }

      if (node.type === "end") {
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
      const result = await this.executeAction(flow.id, node.id, node.action, node.config, scope);
      await scope.dispose();

      if (result.type === "end") {
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
}
