import {
  DeviceLockManager,
  DeviceRegistry,
  InputSourceRegistry,
} from "@tripley-kit/web-container-device-core";
import { FrameworkError } from "@tripley-kit/web-container-errors";
import { MemoryScopedStore } from "@tripley-kit/web-container-scoped-store";

import {
  ActionNodeExecutor,
  DecisionNodeExecutor,
  SubflowNodeExecutor,
  TerminalNodeExecutor,
  WaitEventNodeExecutor,
} from "./builtin-nodes";
import type {
  FlowCancellationReason,
  FlowEngine,
  FlowEngineOptions,
  FlowInstance,
  FlowInstanceFilter,
  FlowStartOptions,
} from "./engine-types";
import { FlowInstanceRuntime } from "./instance-runtime";
import { FlowNodeRuntime } from "./node-runtime";
import {
  EffectRunnerRegistry,
  FlowNodeExecutorRegistry,
  FlowPolicyRegistry,
} from "./registries";
import type {
  FlowDefinition,
  FlowInstanceSnapshot,
  FlowPolicies,
} from "./types";
import { UserInputNodeExecutor } from "./user-input";

interface ManagedFlowInstance {
  readonly completion: Promise<FlowInstanceSnapshot>;
  snapshot(): FlowInstanceSnapshot;
  cancel(reason: FlowCancellationReason): Promise<void>;
  pause(reason?: string): Promise<void>;
  resume(input?: unknown): Promise<void>;
}

export class ExecutableFlowEngine implements FlowEngine {
  public readonly nodeExecutors: FlowNodeExecutorRegistry;
  public readonly effectRunners: EffectRunnerRegistry;
  public readonly flowPolicies: FlowPolicyRegistry;
  public readonly inputSources: InputSourceRegistry;
  private readonly definitions = new Map<
    string,
    Map<string, FlowDefinition>
  >();
  private readonly active = new Map<string, ManagedFlowInstance>();
  private readonly completed = new Map<string, FlowInstanceSnapshot>();
  private readonly devices: DeviceRegistry;
  private readonly deviceLocks: DeviceLockManager;
  private readonly scopedStore: MemoryScopedStore | FlowEngineOptions["scopedStore"];
  private sequence = 1;

  public constructor(private readonly options: FlowEngineOptions = {}) {
    this.nodeExecutors =
      options.nodeExecutors ?? new FlowNodeExecutorRegistry();
    this.effectRunners =
      options.effectRunners ?? new EffectRunnerRegistry();
    this.flowPolicies =
      options.flowPolicies ?? new FlowPolicyRegistry();
    this.inputSources =
      options.inputSources ?? new InputSourceRegistry();
    this.devices = options.devices ?? new DeviceRegistry();
    this.deviceLocks = options.deviceLocks ?? new DeviceLockManager();
    this.scopedStore = options.scopedStore ?? new MemoryScopedStore();
    this.registerBuiltins();
  }

  public register<Input, Output>(
    definition: FlowDefinition<Input, Output>,
  ): void {
    const versions =
      this.definitions.get(definition.id) ??
      new Map<string, FlowDefinition>();
    if (versions.has(definition.version)) {
      throw new FrameworkError({
        category: "extension",
        code: "flow.definition.duplicate",
        message: `Flow definition is already registered: ${definition.id}@${definition.version}`,
      });
    }
    versions.set(definition.version, definition as FlowDefinition);
    this.definitions.set(definition.id, versions);
  }

  public unregister(flowId: string, version?: string): void {
    if (!version) {
      this.definitions.delete(flowId);
      return;
    }
    const versions = this.definitions.get(flowId);
    versions?.delete(version);
    if (versions?.size === 0) {
      this.definitions.delete(flowId);
    }
  }

  public async start<Input, Output>(
    flowId: string,
    input: Input,
    startOptions: FlowStartOptions = {},
  ): Promise<FlowInstance<Output>> {
    const definition = this.requireDefinition<Input, Output>(
      flowId,
      startOptions.version,
    );
    const validatedInput = definition.inputSchema
      ? await definition.inputSchema.validate(input)
      : input;
    const instanceId =
      startOptions.instanceId ??
      this.options.instanceIdFactory?.() ??
      `flow-${this.sequence++}`;
    if (this.active.has(instanceId) || this.completed.has(instanceId)) {
      throw new FrameworkError({
        category: "configuration",
        code: "flow.instance.duplicate",
        message: `Flow instance already exists: ${instanceId}`,
      });
    }

    const runtime = new FlowInstanceRuntime<Output>(instanceId, {
      definition: definition as FlowDefinition<unknown, Output>,
      deviceLocks: startOptions.deviceLocks ?? this.deviceLocks,
      devices: startOptions.devices ?? this.devices,
      evaluateCondition: startOptions.evaluateCondition,
      hooks: [
        ...(this.options.hooks ?? []),
        ...(definition.hooks ?? []),
      ],
      input: validatedInput,
      instanceId,
      interrupt: startOptions.interrupt,
      logger: startOptions.logger ?? this.options.logger,
      nodeRuntime: new FlowNodeRuntime(
        this.nodeExecutors,
        this.effectRunners,
      ),
      onUiFeedback: startOptions.onUiFeedback,
      policies: this.resolvePolicies(definition, startOptions),
      projection: startOptions.projection ?? this.options.projection,
      scopedStore: startOptions.scopedStore ?? this.scopedStore!,
      signal: startOptions.signal,
      stopOn: new Set(startOptions.stopOn ?? []),
      traceId: startOptions.traceId,
    });
    this.active.set(instanceId, runtime);
    void runtime.completion.then((snapshot) => {
      this.active.delete(instanceId);
      this.completed.set(instanceId, snapshot);
      this.trimCompletedInstances();
    });
    runtime.start();
    return runtime;
  }

  public async pause(instanceId: string, reason?: string): Promise<void> {
    await this.requireActive(instanceId).pause(reason);
  }

  public async resume(instanceId: string, input?: unknown): Promise<void> {
    await this.requireActive(instanceId).resume(input);
  }

  public async cancel(
    instanceId: string,
    reason: FlowCancellationReason = {
      reasonCode: "FLOW.CANCELLED",
      source: "system",
    },
  ): Promise<void> {
    await this.requireActive(instanceId).cancel(reason);
  }

  public async getInstance(
    instanceId: string,
  ): Promise<FlowInstanceSnapshot | null> {
    return (
      this.active.get(instanceId)?.snapshot() ??
      this.completed.get(instanceId) ??
      null
    );
  }

  public async listInstances(
    filter: FlowInstanceFilter = {},
  ): Promise<readonly FlowInstanceSnapshot[]> {
    return [
      ...[...this.active.values()].map((instance) =>
        instance.snapshot(),
      ),
      ...this.completed.values(),
    ].filter(
      (snapshot) =>
        (!filter.flowId || snapshot.flowId === filter.flowId) &&
        (!filter.status || snapshot.status === filter.status),
    );
  }

  public async dispose(): Promise<void> {
    await Promise.all(
      [...this.active.values()].map((instance) =>
        instance.cancel({
          reasonCode: "FLOW.ENGINE.DISPOSED",
          source: "system",
        }),
      ),
    );
    this.active.clear();
    this.completed.clear();
  }

  private registerBuiltins(): void {
    for (const executor of [
      new ActionNodeExecutor(),
      new DecisionNodeExecutor(),
      new WaitEventNodeExecutor(),
      new TerminalNodeExecutor(),
      new UserInputNodeExecutor({ inputSources: this.inputSources }),
      new SubflowNodeExecutor(this),
    ]) {
      if (!this.nodeExecutors.has(executor.kind)) {
        this.nodeExecutors.registerExecutor(executor);
      }
    }
  }

  private requireDefinition<Input, Output>(
    flowId: string,
    version?: string,
  ): FlowDefinition<Input, Output> {
    const versions = this.definitions.get(flowId);
    const definition = version
      ? versions?.get(version)
      : [...(versions?.values() ?? [])].at(-1);
    if (!definition) {
      throw new FrameworkError({
        category: "extension",
        code: "flow.definition.missing",
        message: `Flow definition is not registered: ${flowId}${version ? `@${version}` : ""}`,
      });
    }
    return definition as FlowDefinition<Input, Output>;
  }

  private requireActive(instanceId: string): ManagedFlowInstance {
    const instance = this.active.get(instanceId);
    if (!instance) {
      throw new FrameworkError({
        category: "configuration",
        code: "flow.instance.notActive",
        message: `Flow instance is not active: ${instanceId}`,
      });
    }
    return instance;
  }

  private resolvePolicies(
    definition: FlowDefinition,
    startOptions: FlowStartOptions,
  ): FlowPolicies {
    const registered = this.flowPolicies.has("flow.defaults")
      ? (this.flowPolicies.requirePolicy("flow.defaults")
          .policy as FlowPolicies)
      : {};
    return mergePolicies(
      registered,
      this.options.defaultPolicies ?? {},
      definition.policies ?? {},
      startOptions.policies ?? {},
    );
  }

  private trimCompletedInstances(): void {
    const maximum =
      this.options.completedInstanceRetention?.maxCount ?? 100;
    while (this.completed.size > Math.max(0, maximum)) {
      const oldest = this.completed.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.completed.delete(oldest);
    }
  }
}

export const createFlowEngine = (
  options: FlowEngineOptions = {},
): ExecutableFlowEngine => new ExecutableFlowEngine(options);

function mergePolicies(
  ...policies: readonly FlowPolicies[]
): FlowPolicies {
  return policies.reduce<FlowPolicies>(
    (merged, policy) => ({
      ...merged,
      ...policy,
      interrupts:
        policy.interrupts ?? merged.interrupts,
      recovery: policy.recovery ?? merged.recovery,
      trace: policy.trace ?? merged.trace,
      userInputTimeout:
        policy.userInputTimeout ?? merged.userInputTimeout,
    }),
    {},
  );
}
