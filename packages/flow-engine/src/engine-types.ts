import type {
  DeviceLockManager,
  DeviceRegistry,
  InputSourceRegistry,
} from "@tripley-kit/web-container-device-core";
import type { LoggerPort } from "@tripley-kit/web-container-logging";
import type { ScopedStore } from "@tripley-kit/web-container-scoped-store";
import type { MaybePromise } from "@tripley-kit/web-container-types";

import type {
  CancellationSource,
  FlowDefinition,
  FlowHook,
  FlowInstanceSnapshot,
  FlowInterrupt,
  FlowNodeResult,
  FlowPolicies,
  UiFeedbackState,
} from "./types";
import type {
  EffectRunnerRegistry,
  FlowNodeExecutorRegistry,
  FlowPolicyRegistry,
} from "./registries";

export interface FlowEngine {
  register<Input = unknown, Output = unknown>(
    definition: FlowDefinition<Input, Output>,
  ): void;
  unregister(flowId: string, version?: string): void;
  start<Input = unknown, Output = unknown>(
    flowId: string,
    input: Input,
    options?: FlowStartOptions,
  ): Promise<FlowInstance<Output>>;
  pause(instanceId: string, reason?: string): Promise<void>;
  resume(instanceId: string, input?: unknown): Promise<void>;
  cancel(
    instanceId: string,
    reason?: FlowCancellationReason,
  ): Promise<void>;
  getInstance(
    instanceId: string,
  ): Promise<FlowInstanceSnapshot | null>;
  listInstances(
    filter?: FlowInstanceFilter,
  ): Promise<readonly FlowInstanceSnapshot[]>;
  dispose(): Promise<void>;
}

export interface FlowInstance<Output = unknown> {
  readonly instanceId: string;
  readonly flowId: string;
  readonly flowVersion: string;
  readonly completion: Promise<FlowInstanceSnapshot<Output>>;
  snapshot(): FlowInstanceSnapshot<Output>;
}

export interface FlowStartOptions {
  readonly version?: string | undefined;
  readonly instanceId?: string | undefined;
  readonly traceId?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly interrupt?: Promise<FlowInterrupt> | undefined;
  readonly devices?: DeviceRegistry | undefined;
  readonly deviceLocks?: DeviceLockManager | undefined;
  readonly scopedStore?: ScopedStore | undefined;
  readonly logger?: LoggerPort | undefined;
  readonly policies?: FlowPolicies | undefined;
  readonly projection?: FlowProjectionPort | undefined;
  readonly stopOn?: readonly Extract<
    FlowNodeResult["type"],
    "stay" | "reenter"
  >[];
  readonly evaluateCondition?:
    | ((conditionId: string) => MaybePromise<boolean>)
    | undefined;
  readonly onUiFeedback?:
    | ((feedback: UiFeedbackState) => void)
    | undefined;
}

export interface FlowEngineOptions {
  readonly nodeExecutors?: FlowNodeExecutorRegistry | undefined;
  readonly effectRunners?: EffectRunnerRegistry | undefined;
  readonly flowPolicies?: FlowPolicyRegistry | undefined;
  readonly inputSources?: InputSourceRegistry | undefined;
  readonly devices?: DeviceRegistry | undefined;
  readonly deviceLocks?: DeviceLockManager | undefined;
  readonly scopedStore?: ScopedStore | undefined;
  readonly logger?: LoggerPort | undefined;
  readonly defaultPolicies?: FlowPolicies | undefined;
  readonly hooks?: readonly FlowHook[] | undefined;
  readonly projection?: FlowProjectionPort | undefined;
  readonly completedInstanceRetention?:
    | FlowCompletedInstanceRetentionPolicy
    | undefined;
  readonly instanceIdFactory?: (() => string) | undefined;
}

export interface FlowCompletedInstanceRetentionPolicy {
  readonly maxCount: number;
}

export interface FlowCancellationReason {
  readonly source?: CancellationSource | undefined;
  readonly reasonCode: string;
  readonly metadata?: unknown;
}

export interface FlowInstanceFilter {
  readonly flowId?: string | undefined;
  readonly status?: FlowInstanceSnapshot["status"] | undefined;
}

export interface FlowProjectionPort {
  publish(snapshot: FlowInstanceSnapshot): MaybePromise<void>;
}
