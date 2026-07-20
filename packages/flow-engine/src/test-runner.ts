import {
  DeviceLockManager,
  DeviceRegistry,
  InputSourceRegistry,
} from "@tripley-kit/web-container-device-core";
import { MemoryScopedStore } from "@tripley-kit/web-container-scoped-store";

import { FlowNodeExecutorRegistry } from "./registries";
import type {
  FlowDefinition,
  FlowExecutionContext,
  FlowInstanceSnapshot,
  FlowNodeDefinition,
  FlowNodeResult,
  FlowTestRunnerOptions,
  FlowTraceEvent,
  UiFeedbackState,
} from "./types";
import { UserInputNodeExecutor } from "./user-input";

export interface FlowTestRunnerRegistries {
  readonly inputSources?: InputSourceRegistry | undefined;
  readonly nodeExecutors?: FlowNodeExecutorRegistry | undefined;
}

export class FlowTestRunner {
  public readonly inputSources: InputSourceRegistry;
  public readonly nodeExecutors: FlowNodeExecutorRegistry;

  public constructor(registries: FlowTestRunnerRegistries = {}) {
    this.inputSources = registries.inputSources ?? new InputSourceRegistry();
    this.nodeExecutors = registries.nodeExecutors ?? new FlowNodeExecutorRegistry();
    if (!this.nodeExecutors.has("userInput")) {
      this.nodeExecutors.registerExecutor(
        new UserInputNodeExecutor({ inputSources: this.inputSources }),
      );
    }
  }

  public async run<Input = unknown, Output = unknown>(
    definition: FlowDefinition<Input, Output>,
    input: Input,
    options: FlowTestRunnerOptions = {},
  ): Promise<FlowInstanceSnapshot<Output>> {
    const instanceId = `test-flow-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const path: string[] = [];
    const uiFeedback: UiFeedbackState[] = [];
    const trace: FlowTraceEvent[] = [];
    const scopedStore = options.scopedStore ?? new MemoryScopedStore();
    const devices = options.devices ?? new DeviceRegistry();
    const deviceLocks = options.deviceLocks ?? new DeviceLockManager();
    let currentNodeId: string | undefined = definition.startNodeId;
    let result: FlowNodeResult | undefined;

    const ctx: FlowExecutionContext = {
      definition,
      devices,
      deviceLocks,
      flowId: definition.id,
      flowVersion: definition.version,
      input,
      instanceId,
      logger: options.logger,
      nodeId: definition.startNodeId,
      policies: definition.policies ?? {},
      scopedStore,
      signal: options.signal,
      traceId: options.traceId,
      interrupt: options.interrupt,
      evaluateCondition: options.evaluateCondition,
      setUiFeedback: (feedback) => {
        uiFeedback.push(feedback);
      },
      trace: {
        record: (event) => {
          trace.push(event);
        },
      },
    };

    while (currentNodeId) {
      const node: FlowNodeDefinition | undefined = definition.nodes[currentNodeId];
      if (!node) {
        return {
          currentNodeId,
          flowId: definition.id,
          flowVersion: definition.version,
          instanceId,
          path,
          result: {
            type: "fail",
            error: new Error(`Flow node is missing: ${currentNodeId}`),
          },
          status: "failed",
          trace,
          uiFeedback,
        };
      }

      path.push(node.id);
      const nodeCtx: FlowExecutionContext = {
        ...ctx,
        nodeId: node.id,
      };
      const nodeResult = await this.nodeExecutors.requireExecutor(node.kind).execute(nodeCtx, node);
      result = nodeResult;

      if (nodeResult.type === "next") {
        currentNodeId = nodeResult.nodeId;
        continue;
      }

      if (nodeResult.type === "branch") {
        currentNodeId = definition.edges?.find(
          (edge) => edge.from === node.id && edge.branch === nodeResult.branch,
        )?.to;
        continue;
      }

      const status = statusFromResult(nodeResult);
      return {
        currentNodeId:
          nodeResult.type === "stay" || nodeResult.type === "reenter" ? nodeResult.nodeId : node.id,
        flowId: definition.id,
        flowVersion: definition.version,
        instanceId,
        output: nodeResult.type === "end" ? (nodeResult.output as Output) : undefined,
        path,
        result: nodeResult,
        status,
        trace,
        uiFeedback,
      };
    }

    return {
      flowId: definition.id,
      flowVersion: definition.version,
      instanceId,
      output: result?.type === "end" ? (result.output as Output) : undefined,
      path,
      result,
      status: "completed",
      trace,
      uiFeedback,
    };
  }
}

const statusFromResult = (result: FlowNodeResult): FlowInstanceSnapshot["status"] => {
  if (result.type === "end") {
    return "completed";
  }

  if (result.type === "fail") {
    return "failed";
  }

  if (result.type === "cancel") {
    return "cancelled";
  }

  if (result.type === "pause") {
    return "paused";
  }

  return "running";
};

export const expectFlow = (definition: FlowDefinition): FlowTestRunner => {
  const runner = new FlowTestRunner();
  void definition;
  return runner;
};
