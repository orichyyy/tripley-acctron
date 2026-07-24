import type { FlowVersionBinding } from "@tripley-kit/web-container-flow-engine";
import type { MediaCustodyStatus, OperationLedger } from "@tripley-kit/web-container-kiosk-base";
import type { LoggerPort } from "@tripley-kit/web-container-logging";
import type { PromptIntent, PromptPresenterPort } from "@tripley-kit/web-container-prompt-presentation";
import type { ScopedStore } from "@tripley-kit/web-container-scoped-store";
import type { JsonValue, MaybePromise } from "@tripley-kit/web-container-types";
import type { UiPort } from "@tripley-kit/web-container-ui-port";

export type KioskRuntimeMode = "memory" | "hostd";
export type CapabilityStatus = "available" | "degraded" | "unavailable";

export interface CapabilitySnapshot {
  readonly values: Readonly<Record<string, CapabilityStatus>>;
  status(capabilityId: string): CapabilityStatus;
}

export interface EntryAvailability {
  readonly available: boolean;
  readonly reasonCode?: string | undefined;
  readonly messageKey?: string | undefined;
}

export interface EntryAvailabilityContext {
  readonly mode: KioskRuntimeMode;
  readonly capabilities: CapabilitySnapshot;
}

export interface AccessCredential {
  readonly id: string;
  readonly entryMethodId: string;
  readonly safeSummary: Readonly<Record<string, JsonValue>>;
}

export interface AuthenticationRequirement {
  readonly kind: string;
  readonly parameters?: Readonly<Record<string, JsonValue>> | undefined;
}

export interface CredentialAssessment {
  readonly credential: AccessCredential;
  readonly requirements: readonly AuthenticationRequirement[];
  readonly riskBand: "standard" | "elevated";
}

export interface OperationInteractionPolicy {
  readonly operationDeadlineMs: number;
  readonly interactionTimeouts: Readonly<Record<string, number>>;
  readonly attemptBudgets: Readonly<Record<string, number>>;
}

export interface AccessibilityInteractionPolicy {
  readonly timeoutMultiplier: number;
  readonly maximumTimeoutMultiplier: number;
}

export interface OperationExecutionContext {
  readonly operationId: string;
  readonly entryMethodId: string;
  readonly signal: AbortSignal;
  readonly compensationSignal: AbortSignal;
  readonly deadlineAt: number;
  readonly capabilities: CapabilitySnapshot;
  readonly mode: KioskRuntimeMode;
  readonly prompt?: PromptPresenterPort | undefined;
  getMediaCustody(): MediaCustodyStatus;
  interactionTimeout(policyId: string): number;
  updateView(patch: OperationViewPatch): void;
  consumeAttempt(policyId: string): number;
  setMediaCustody(status: MediaCustodyStatus): Promise<void>;
}

export interface CredentialAcquisitionContract {
  readonly flow: FlowVersionBinding;
  acquire(ctx: OperationExecutionContext): Promise<CredentialAssessment>;
}

export interface MediaCustodyResolution {
  readonly status: Extract<MediaCustodyStatus, "returned" | "retained" | "unknown" | "none">;
  readonly reasonCode?: string | undefined;
}

export interface MediaCustodyPolicy {
  readonly kind: "none" | "physical";
  resolve(
    ctx: OperationExecutionContext,
    outcome: "completed" | "failed" | "interrupted",
  ): Promise<MediaCustodyResolution>;
  reconcile?(ctx: CustodyReconciliationContext): Promise<MediaCustodyResolution>;
}

export interface CustodyReconciliationContext {
  readonly operationId: string;
  readonly entryMethodId: string;
  readonly signal: AbortSignal;
  readonly recordedStatus: MediaCustodyStatus;
}

export interface EntryMethodContribution {
  readonly id: string;
  readonly version: string;
  readonly labelKey: string;
  readonly order?: number | undefined;
  readonly requiredCapabilities?: readonly string[] | undefined;
  readonly interruptBindings?: readonly string[] | undefined;
  readonly acquisition: CredentialAcquisitionContract;
  readonly mediaCustody: MediaCustodyPolicy;
  availability(ctx: EntryAvailabilityContext): MaybePromise<EntryAvailability>;
}

export interface AuthenticationChallengeContext extends OperationExecutionContext {
  readonly credential: AccessCredential;
}

export interface AuthenticationChallengeResult {
  readonly authenticated: boolean;
  readonly safeSummary: Readonly<Record<string, JsonValue>>;
  readonly reasonCode?: string | undefined;
}

export interface AuthenticationChallengeContribution {
  readonly id: string;
  readonly version: string;
  readonly requiredCapabilities?: readonly string[] | undefined;
  validateParameters?(parameters: Readonly<Record<string, JsonValue>>): void;
  execute(
    ctx: AuthenticationChallengeContext,
    requirement: AuthenticationRequirement,
  ): Promise<AuthenticationChallengeResult>;
}

export interface AuthenticationPlanItem {
  readonly challengeId: string;
  readonly challengeVersion: string;
  readonly requirement: AuthenticationRequirement;
}

export interface AuthenticationPlan {
  readonly items: readonly AuthenticationPlanItem[];
}

export type OperationPhase =
  | "idle"
  | "waitingCredential"
  | "collectingInput"
  | "authenticating"
  | "processing"
  | "takeMedia"
  | "completed"
  | "failed"
  | "interrupted"
  | "recovering"
  | "intervention";

export interface OperationViewState {
  readonly revision: number;
  readonly phase: OperationPhase;
  readonly operationId?: string | undefined;
  readonly entryMethodId?: string | undefined;
  readonly promptId?: string | undefined;
  readonly feedback?:
    | {
        readonly messageKey: string;
        readonly reasonCode?: string | undefined;
        readonly severity: "info" | "warning" | "error";
      }
    | undefined;
  readonly mediaCustody: MediaCustodyStatus;
  readonly safeData?: Readonly<Record<string, JsonValue>> | undefined;
}

export type OperationViewPatch = Omit<Partial<OperationViewState>, "revision">;

export interface EntryMethodAvailabilitySnapshot extends EntryAvailability {
  readonly id: string;
  readonly version: string;
  readonly labelKey: string;
  readonly order: number;
}

export interface RuntimeReadiness {
  readonly status: "ready" | "degraded" | "failed" | "recovering" | "intervention";
  readonly mode: KioskRuntimeMode;
  readonly entryMethods: readonly EntryMethodAvailabilitySnapshot[];
}

export interface StartCustomerOperationInput {
  readonly entryMethodId: string;
  readonly intentId: string;
}

export interface CustomerOperationResult {
  readonly operationId: string;
  readonly status: "completed" | "failed" | "interrupted" | "intervention";
  readonly entryMethodId: string;
  readonly safeOutput?: JsonValue | undefined;
  readonly reasonCode?: string | undefined;
}

export interface CustomerOperationExitContext {
  readonly entryMethodId: string;
  readonly operationId: string;
  readonly outcome: "completed" | "failed" | "interrupted";
}

export interface KioskAuditPort {
  append(input: {
    readonly eventId: string;
    readonly message: string;
    readonly transactionId?: string | undefined;
    readonly data?: JsonValue | undefined;
  }): Promise<unknown>;
}

export interface LauncherStartupObservation {
  readonly runtimeInstanceId: string;
  readonly startedAt: string;
  readonly watchdogHealthy: boolean;
  readonly previousRuntime?: {
    readonly instanceId: string;
    readonly lostAt: string;
    readonly exitReason?: string | undefined;
  } | undefined;
}

export interface KioskLauncherSupervisionPort {
  observeStartup(): Promise<LauncherStartupObservation>;
}

export interface RecoveryStartupBarrierPort {
  recover(): Promise<{
    readonly status: "ready" | "recovering" | "intervention";
    readonly safeSummary: Readonly<Record<string, string | number | boolean>>;
  }>;
}

export interface CashRuntimeSafetyPolicy {
  readonly enabled: boolean;
  readonly restartWindowMs: number;
}

export interface KioskRuntimePorts {
  readonly ledger: OperationLedger;
  readonly scopedStore: ScopedStore;
  readonly ui: UiPort;
  readonly audit?: KioskAuditPort | undefined;
  readonly logger?: LoggerPort | undefined;
  readonly prompt?: PromptPresenterPort | undefined;
  readonly launcherSupervision?: KioskLauncherSupervisionPort | undefined;
  readonly recoveryStartup?: RecoveryStartupBarrierPort | undefined;
}

export interface KioskRuntimeOptions {
  readonly mode: KioskRuntimeMode;
  readonly accessibilityInteraction?: AccessibilityInteractionPolicy | undefined;
  readonly capabilities?: Readonly<Record<string, CapabilityStatus>> | undefined;
  readonly requiredCapabilities?: readonly string[] | undefined;
  readonly entryMethods?: readonly EntryMethodContribution[] | undefined;
  readonly authenticationChallenges?: readonly AuthenticationChallengeContribution[] | undefined;
  readonly mandatoryAuthentication?:
    | ((assessment: CredentialAssessment) => readonly AuthenticationRequirement[])
    | undefined;
  readonly policy: OperationInteractionPolicy;
  readonly cashSafety?: CashRuntimeSafetyPolicy | undefined;
  readonly ports: KioskRuntimePorts;
  readonly now?: (() => number) | undefined;
  readonly operationIdFactory?: (() => string) | undefined;
  readonly promptIntent?: ((state: OperationViewState) => PromptIntent | undefined) | undefined;
  prepareOperation?(
    ctx: OperationExecutionContext,
    assessment: CredentialAssessment,
  ): Promise<void>;
  executeBusiness?(
    ctx: OperationExecutionContext,
    assessment: CredentialAssessment,
  ): Promise<JsonValue | undefined>;
  onOperationExit?(context: CustomerOperationExitContext): void;
}

export interface KioskRuntimeSnapshot {
  readonly readiness: RuntimeReadiness;
  readonly operation: OperationViewState;
}
