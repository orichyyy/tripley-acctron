import type {
  DeviceLockManager,
  DeviceRegistry,
  InputSourceProgress,
  UserInputSourceDefinition as DeviceUserInputSourceDefinition,
  InputSourceExecutionContext,
  UserInputSourceResult,
} from "@tripley-kit/web-container-device-core";
import type { LoggerPort } from "@tripley-kit/web-container-logging";
import type { ScopedStore } from "@tripley-kit/web-container-scoped-store";
import type { MaybePromise } from "@tripley-kit/web-container-types";

export type BuiltinFlowNodeKind =
  | "action"
  | "userInput"
  | "waitEvent"
  | "decision"
  | "parallel"
  | "race"
  | "subflow"
  | "compensation"
  | "terminal";

export type FlowNodeKind = BuiltinFlowNodeKind | (string & {});

export type EffectKind = string & {};

export type FlowPolicyKind = string & {};

export interface FlowValidator<TValue = unknown> {
  validate(value: unknown): MaybePromise<TValue>;
}

export interface FlowDefinition<Input = unknown, Output = unknown> {
  readonly id: string;
  readonly version: string;
  readonly description?: string | undefined;
  readonly inputSchema?: FlowValidator<Input> | undefined;
  readonly outputSchema?: FlowValidator<Output> | undefined;
  readonly startNodeId: string;
  readonly nodes: Record<string, AnyFlowNodeDefinition>;
  readonly edges?: readonly FlowEdge[] | undefined;
  readonly concurrency?: FlowConcurrencyPolicy | undefined;
  readonly timeoutMs?: number | undefined;
  readonly retry?: FlowRetryPolicy | undefined;
  readonly policies?: FlowPolicies | undefined;
  readonly hooks?: readonly FlowHook[] | undefined;
  readonly catch?: FlowErrorHandler | undefined;
  readonly finally?: FlowFinallyHandler | undefined;
  readonly compensation?: FlowCompensationPolicy | undefined;
  readonly recovery?: FlowRecoveryPolicy | undefined;
  readonly trace?: TraceSummaryPolicy | undefined;
}

export interface FlowVersionBinding {
  readonly flowId: string;
  readonly version: string;
}

export interface FlowEdge {
  readonly from: string;
  readonly to: string;
  readonly branch?: string | undefined;
}

export interface FlowConcurrencyPolicy {
  readonly maxParallelNodes?: number | undefined;
}

export interface FlowRetryPolicy {
  readonly maxAttempts: number;
  readonly backoffMs?: number | undefined;
}

export interface FlowCompensationPolicy {
  readonly enabled: boolean;
  readonly nodeIds?: readonly string[] | undefined;
}

export type FlowRecoveryMode = "discard" | "manualRecover" | "autoRecover";

export interface FlowRecoveryPolicy {
  readonly mode: FlowRecoveryMode;
  readonly resumeFrom?: "currentNode" | "lastCheckpoint" | undefined;
  readonly maxAgeMs?: number | undefined;
}

export interface TraceSummaryPolicy {
  readonly summaryOnly?: boolean | undefined;
  readonly includeNodeOutputs?: boolean | undefined;
  readonly redactSecureInput?: boolean | undefined;
}

export interface UserInputTimeoutPolicy {
  readonly timeoutMs: number;
  readonly onTimeout: FlowNodeResult;
}

export interface FlowInterruptPolicy {
  readonly id: string;
  readonly priority: number;
  readonly eventTopic?: string | undefined;
  readonly appliesTo?: string | undefined;
  readonly action: FlowInterruptAction;
}

export type FlowInterruptAction =
  | { readonly type: "cancelFlow"; readonly reasonCode: string }
  | { readonly type: "next"; readonly nodeId: string }
  | { readonly type: "pause"; readonly reasonCode: string };

export interface FlowPolicies {
  readonly userInputTimeout?: UserInputTimeoutPolicy | undefined;
  readonly interrupts?: readonly FlowInterruptPolicy[] | undefined;
  readonly recovery?: FlowRecoveryPolicy | undefined;
  readonly trace?: TraceSummaryPolicy | undefined;
  readonly [key: string]: unknown;
}

export type FlowHookName =
  | "beforeFlowStart"
  | "afterFlowStart"
  | "beforeNodeRun"
  | "afterNodeRun"
  | "onNodeError"
  | "onNodeTimeout"
  | "onFlowInterrupt"
  | "onFlowComplete"
  | "onFlowFail"
  | "onFlowCancel"
  | "onFlowFinally";

export interface FlowHook {
  readonly name: FlowHookName | (string & {});
  run(ctx: FlowExecutionContext, event: FlowHookEvent): MaybePromise<void>;
}

export interface FlowHookEvent {
  readonly flowId: string;
  readonly flowVersion: string;
  readonly instanceId: string;
  readonly nodeId?: string | undefined;
  readonly result?: FlowNodeResult | undefined;
  readonly error?: unknown;
}

export type FlowErrorHandler = (
  ctx: FlowExecutionContext,
  error: unknown,
) => MaybePromise<FlowNodeResult>;

export type FlowFinallyHandler = (ctx: FlowExecutionContext) => MaybePromise<void>;

export interface FlowNodeDefinition<TKind extends FlowNodeKind = FlowNodeKind> {
  readonly id: string;
  readonly kind: TKind;
  readonly timeoutMs?: number | undefined;
  readonly next?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface ActionFlowNodeDefinition
  extends FlowNodeDefinition<"action"> {
  run(
    ctx: FlowExecutionContext,
  ): MaybePromise<FlowNodeResult | unknown>;
}

export interface DecisionFlowNodeDefinition
  extends FlowNodeDefinition<"decision"> {
  decide(ctx: FlowExecutionContext): MaybePromise<string>;
}

export interface WaitEventFlowNodeDefinition
  extends FlowNodeDefinition<"waitEvent"> {
  readonly waitFor: FlowWaitCondition;
}

export interface TerminalFlowNodeDefinition
  extends FlowNodeDefinition<"terminal"> {
  readonly output?:
    | unknown
    | ((ctx: FlowExecutionContext) => MaybePromise<unknown>);
}

export interface FlowWaitCondition {
  readonly topic: string;
  readonly timeoutMs?: number | undefined;
}

export interface Effect {
  readonly kind: EffectKind;
  readonly payload?: unknown;
}

export type CancellationSource = "timeout" | "interrupt" | "user" | "system" | (string & {});

export type FlowNodeResult =
  | { readonly type: "next"; readonly nodeId: string; readonly output?: unknown }
  | { readonly type: "branch"; readonly branch: string; readonly output?: unknown }
  | { readonly type: "wait"; readonly waitFor: FlowWaitCondition }
  | { readonly type: "end"; readonly output?: unknown }
  | { readonly type: "fail"; readonly error: unknown }
  | {
      readonly type: "cancel";
      readonly source?: CancellationSource | undefined;
      readonly reasonCode: string;
      readonly metadata?: unknown;
    }
  | { readonly type: "pause"; readonly reasonCode: string; readonly metadata?: unknown }
  | { readonly type: "retry"; readonly reasonCode: string }
  | { readonly type: "effects"; readonly effects: readonly Effect[] }
  | { readonly type: "stay"; readonly nodeId: string; readonly feedback: UiFeedbackState }
  | { readonly type: "reenter"; readonly nodeId: string; readonly feedback: UiFeedbackState };

export interface FlowNodeExecutor<TNode extends FlowNodeDefinition = FlowNodeDefinition> {
  readonly kind: FlowNodeKind;
  execute(ctx: FlowExecutionContext, node: TNode): Promise<FlowNodeResult>;
}

export interface EffectRunner<TEffect extends Effect = Effect> {
  readonly kind: EffectKind;
  run(ctx: FlowExecutionContext, effect: TEffect): Promise<FlowNodeResult | undefined>;
}

export interface FlowPolicy<TPolicy = unknown> {
  readonly kind: FlowPolicyKind;
  readonly policy: TPolicy;
}

export interface FlowExecutionContext extends InputSourceExecutionContext {
  readonly definition: FlowDefinition;
  readonly input: unknown;
  readonly scopedStore: ScopedStore;
  readonly logger?: LoggerPort | undefined;
  readonly policies: FlowPolicies;
  readonly trace: FlowTraceRecorder;
  readonly interrupt?: Promise<FlowInterrupt> | undefined;
  readonly evaluateCondition?: ((conditionId: string) => MaybePromise<boolean>) | undefined;
  setUiFeedback(feedback: UiFeedbackState): void;
}

export interface FlowInterrupt {
  readonly id: string;
  readonly reasonCode: string;
  readonly priority?: number | undefined;
}

export interface FlowTraceRecorder {
  record(event: FlowTraceEvent): void;
}

export interface FlowTraceEvent {
  readonly type: string;
  readonly flowId: string;
  readonly flowVersion: string;
  readonly instanceId: string;
  readonly nodeId?: string | undefined;
  readonly summary?: Record<string, unknown> | undefined;
}

export interface InputProfile {
  readonly id: string;
  readonly promptKey: string;
  readonly constraints?: InputConstraints | undefined;
  readonly sourceOptions?: Record<string, unknown> | undefined;
  readonly validatorId?: string | undefined;
  readonly errorMessageKeys?: Record<string, string> | undefined;
}

export interface InputConstraints {
  readonly minLength?: number | undefined;
  readonly maxLength?: number | undefined;
  readonly inputMode?: "numeric" | "text" | "tel" | "decimal" | undefined;
}

export type InputProfileResolver = (ctx: FlowExecutionContext) => MaybePromise<InputProfile>;

export interface UiRouteState {
  readonly path?: string | undefined;
  readonly stateKey: string;
  readonly promptKey?: string | undefined;
}

export type UiRouteResolver = (
  profile: InputProfile,
  ctx: FlowExecutionContext,
) => MaybePromise<UiRouteState>;

export interface UiFeedbackState {
  readonly stateKey?: string | undefined;
  readonly status: "waiting" | "invalid" | "valid" | "timeout" | "interrupted";
  readonly reasonCode?: string | undefined;
  readonly messageKey?: string | undefined;
  readonly messageParams?: Record<string, unknown> | undefined;
  readonly severity?: "info" | "warning" | "error" | undefined;
  readonly clearInput?: boolean | undefined;
  readonly attempt?: number | undefined;
  readonly safeData?: Readonly<Record<string, unknown>> | undefined;
  readonly fieldErrors?:
    | readonly {
        readonly field: string;
        readonly reasonCode: string;
        readonly messageKey: string;
        readonly messageParams?: Record<string, unknown> | undefined;
      }[]
    | undefined;
}

export interface UserInputSourceDefinition<TOptions = unknown>
  extends Omit<DeviceUserInputSourceDefinition<TOptions>, "options"> {
  readonly options?:
    | TOptions
    | ((profile: InputProfile, ctx: FlowExecutionContext) => MaybePromise<TOptions>)
    | undefined;
}

export interface UserInputValidationResult<TValue = unknown> {
  readonly valid: boolean;
  readonly value?: TValue | undefined;
  readonly reasonCode?: string | undefined;
  readonly messageKey?: string | undefined;
  readonly messageParams?: Record<string, unknown> | undefined;
  readonly severity?: "info" | "warning" | "error" | undefined;
  readonly fieldErrors?: UiFeedbackState["fieldErrors"];
  readonly safeSummary?: Record<string, unknown> | undefined;
}

export interface UserInputValidationDefinition {
  local?(
    result: UserInputSourceResult,
    profile: InputProfile,
    ctx: FlowExecutionContext,
  ): MaybePromise<UserInputValidationResult>;
  business?(
    result: UserInputSourceResult,
    profile: InputProfile,
    ctx: FlowExecutionContext,
  ): MaybePromise<UserInputValidationResult>;
  readonly failure?: {
    readonly mode?: "stayOnNode" | "reenter" | undefined;
    readonly maxAttempts?: number | undefined;
    readonly ui?:
      | {
          readonly errorMessageKey?: string | undefined;
          readonly clearInput?: boolean | undefined;
        }
      | undefined;
  };
}

export interface UserInputNodeInput {
  readonly semantic?: string | undefined;
  readonly security?: "plain" | "secure" | undefined;
  readonly profile?: InputProfile | InputProfileResolver | undefined;
  readonly ui?: UiRouteState | UiRouteResolver | undefined;
  readonly sources:
    | readonly UserInputSourceDefinition[]
    | ((
        profile: InputProfile,
        ctx: FlowExecutionContext,
      ) => MaybePromise<readonly UserInputSourceDefinition[]>);
  readonly validation?:
    | UserInputValidationDefinition
    | ((
        profile: InputProfile,
        ctx: FlowExecutionContext,
      ) => MaybePromise<UserInputValidationDefinition>)
    | undefined;
  readonly acceptance?:
    | {
        readonly mode?: "single" | "race" | undefined;
        readonly firstValidWins?: boolean | undefined;
      }
    | undefined;
  readonly cleanup?:
    | {
        readonly cancelDevicesOnExit?: boolean | undefined;
      }
    | undefined;
  readonly trace?:
    | {
        readonly safeToLog?: boolean | undefined;
        readonly summaryOnly?: boolean | undefined;
      }
    | undefined;
  readonly timeoutMs?: number | undefined;
  readonly idleTimeoutMs?: number | undefined;
  readonly progress?:
    | ((
        progress: InputSourceProgress,
        ctx: FlowExecutionContext,
      ) => MaybePromise<UiFeedbackState | undefined>)
    | undefined;
}

export interface UserInputNodeDefinition extends FlowNodeDefinition<"userInput"> {
  readonly input: UserInputNodeInput;
}

export interface SubflowNodeDefinition<TInput = unknown, TOutput = unknown>
  extends FlowNodeDefinition<"subflow"> {
  readonly subflow: {
    readonly flowId: string;
    readonly version: string;
    readonly mode: "sync" | "async";
    readonly input?:
      | TInput
      | ((ctx: FlowExecutionContext) => MaybePromise<TInput>)
      | undefined;
    readonly outputKey?: string | undefined;
    readonly acceptOutput?:
      | ((output: TOutput, ctx: FlowExecutionContext) => MaybePromise<void>)
      | undefined;
  };
}

export type AnyFlowNodeDefinition =
  | FlowNodeDefinition
  | ActionFlowNodeDefinition
  | DecisionFlowNodeDefinition
  | WaitEventFlowNodeDefinition
  | TerminalFlowNodeDefinition
  | UserInputNodeDefinition
  | SubflowNodeDefinition;

export interface FlowInstanceSnapshot<Output = unknown> {
  readonly instanceId: string;
  readonly flowId: string;
  readonly flowVersion: string;
  readonly status: "running" | "completed" | "failed" | "cancelled" | "paused";
  readonly currentNodeId?: string | undefined;
  readonly output?: Output | undefined;
  readonly path: readonly string[];
  readonly result?: FlowNodeResult | undefined;
  readonly uiFeedback: readonly UiFeedbackState[];
  readonly trace: readonly FlowTraceEvent[];
}

export interface FlowTestRunnerOptions {
  readonly devices?: DeviceRegistry | undefined;
  readonly deviceLocks?: DeviceLockManager | undefined;
  readonly logger?: LoggerPort | undefined;
  readonly scopedStore?: ScopedStore | undefined;
  readonly interrupt?: Promise<FlowInterrupt> | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly traceId?: string | undefined;
  readonly evaluateCondition?:
    | ((conditionId: string) => MaybePromise<boolean>)
    | undefined;
}
