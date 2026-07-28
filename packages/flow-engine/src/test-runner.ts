import { InputSourceRegistry } from "@tripley-kit/web-container-device-core";

import { createFlowEngine } from "./engine";
import {
  EffectRunnerRegistry,
  FlowNodeExecutorRegistry,
} from "./registries";
import type {
  FlowDefinition,
  FlowInstanceSnapshot,
  FlowTestRunnerOptions,
} from "./types";

export interface FlowTestRunnerRegistries {
  readonly inputSources?: InputSourceRegistry | undefined;
  readonly nodeExecutors?: FlowNodeExecutorRegistry | undefined;
  readonly effectRunners?: EffectRunnerRegistry | undefined;
}

export class FlowTestRunner {
  public readonly inputSources: InputSourceRegistry;
  public readonly nodeExecutors: FlowNodeExecutorRegistry;
  public readonly effectRunners: EffectRunnerRegistry;

  public constructor(registries: FlowTestRunnerRegistries = {}) {
    this.inputSources = registries.inputSources ?? new InputSourceRegistry();
    this.nodeExecutors = registries.nodeExecutors ?? new FlowNodeExecutorRegistry();
    this.effectRunners =
      registries.effectRunners ?? new EffectRunnerRegistry();
  }

  public async run<Input = unknown, Output = unknown>(
    definition: FlowDefinition<Input, Output>,
    input: Input,
    options: FlowTestRunnerOptions = {},
  ): Promise<FlowInstanceSnapshot<Output>> {
    const engine = createFlowEngine({
      effectRunners: this.effectRunners,
      inputSources: this.inputSources,
      nodeExecutors: this.nodeExecutors,
    });
    engine.register(definition);
    const instance = await engine.start<Input, Output>(
      definition.id,
      input,
      {
        deviceLocks: options.deviceLocks,
        devices: options.devices,
        evaluateCondition: options.evaluateCondition,
        instanceId: `test-flow-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        interrupt: options.interrupt,
        logger: options.logger,
        scopedStore: options.scopedStore,
        signal: options.signal,
        stopOn: ["stay", "reenter"],
        traceId: options.traceId,
      },
    );
    return instance.completion;
  }
}

export const expectFlow = (definition: FlowDefinition): FlowTestRunner => {
  const runner = new FlowTestRunner();
  void definition;
  return runner;
};
