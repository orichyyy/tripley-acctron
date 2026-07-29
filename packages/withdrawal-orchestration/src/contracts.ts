import type {
  OperationFinalizationRecord,
  OperationFinalizationRunner,
} from "@tripley-kit/web-container-kiosk-runtime";
import type {
  CardCustodyInterruptReason,
  CardCustodyLeaseSession,
  CardCustodyRequest,
  CardCustodyResult,
  CashAmount,
  CashCustodyOutcome,
  CashDeliveryExitResult,
  CashDeliveryPhase,
  CashDeliveryTerminalResult,
  CashDispensePlan,
  CashInventorySnapshot,
  CashPresentationAuthorization,
  CashPresentationPolicy,
  StartCashDeliveryRequest,
} from "@tripley-kit/web-container-xfs-device-service";

export type WithdrawalEntryMode = "contact-card" | "cardless-reservation";
export type WithdrawalCardOrder =
  | "return-before-cash-present"
  | "return-after-cash-terminal";
export type WithdrawalCashPlanningOrder =
  | "authorization-before-cash-planning"
  | "cash-planning-before-authorization";
export type WithdrawalHostProtocolMode =
  | "authorization-only"
  | "authorization-then-completion";

export interface WithdrawalHostProtocol {
  readonly id: string;
  readonly version: string;
  readonly mode: WithdrawalHostProtocolMode;
}

export interface WithdrawalPolicy {
  readonly id: string;
  readonly version: string;
  readonly allowedEntryModes: readonly WithdrawalEntryMode[];
  readonly cardOrder: WithdrawalCardOrder;
  readonly cashPlanningOrder?: WithdrawalCashPlanningOrder | undefined;
  readonly cardCustodyPolicyId?: string | undefined;
  readonly prePresentGateIds: readonly string[];
  readonly presentationPolicy: CashPresentationPolicy;
  readonly hostProtocol: WithdrawalHostProtocol;
}

export interface WithdrawalRequest {
  readonly operationId: string;
  readonly ownerInstanceId: string;
  readonly policyId: string;
  readonly entryMode: WithdrawalEntryMode;
  readonly amount: CashAmount;
  readonly cardAuthority?: CardCustodyLeaseSession | undefined;
  readonly interruptReason?: CardCustodyInterruptReason | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly safeMetadata?: Readonly<Record<string, string | number | boolean>> | undefined;
}

export type WithdrawalStatus =
  | "completed"
  | "declined"
  | "cancelled"
  | "timedOut"
  | "failed"
  | "intervention";

export type WithdrawalReason =
  | "completed"
  | "recovery-barrier-blocked"
  | "user-cancelled"
  | "operation-timeout"
  | "host-declined"
  | "host-unavailable"
  | "verification-cancelled"
  | "verification-timeout"
  | "verification-rejected"
  | "cash-start-failed"
  | "cash-dispense-failed"
  | "cash-presentation-not-authorized"
  | "cash-present-failed"
  | "cash-take-timeout"
  | "cash-custody-unknown"
  | "card-take-timeout"
  | "card-cancelled"
  | "card-custody-unresolved"
  | "unexpected-failure";

export type WithdrawalTrigger =
  | "cancel"
  | "timeout"
  | "interrupt"
  | "routeExit"
  | "runtimeShutdown";

export interface WithdrawalHostFacts {
  readonly protocolId: string;
  readonly protocolVersion: string;
  readonly protocolMode: WithdrawalHostProtocolMode;
  readonly status: "not-requested" | "approved" | "declined" | "unavailable";
  readonly authorizationReference?: string | undefined;
  readonly reasonCode?: string | undefined;
}

export interface WithdrawalCashFacts {
  readonly cashSessionId?: string | undefined;
  readonly dispense: "not-requested" | "completed" | "execution-unknown";
  readonly present: "not-requested" | "completed" | "execution-unknown";
  readonly custody: CashCustodyOutcome | "not-started" | "pending" | "recovery-transferred";
  readonly beforeSnapshotId?: string | undefined;
  readonly afterSnapshotId?: string | undefined;
  readonly recoveryTransferId?: string | undefined;
  readonly reconciliationRequired: boolean;
  readonly dispensed: boolean;
  readonly presented: boolean;
  readonly taken: boolean;
  readonly retracted: boolean;
}

export interface WithdrawalCardFacts {
  readonly required: boolean;
  readonly status: "not-applicable" | "pending" | CardCustodyResult["status"];
  readonly reason?: CardCustodyResult["reason"] | undefined;
  readonly mediaState?: CardCustodyResult["mediaState"] | undefined;
  readonly authorityReleased?: boolean | undefined;
}

export interface WithdrawalOutcome {
  readonly kind: "withdrawal.outcome";
  readonly operationId: string;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly entryMode: WithdrawalEntryMode;
  readonly status: WithdrawalStatus;
  readonly reason: WithdrawalReason;
  readonly trigger?: WithdrawalTrigger | undefined;
  readonly host: WithdrawalHostFacts;
  readonly cash: WithdrawalCashFacts;
  readonly card: WithdrawalCardFacts;
  readonly safeSummary: Readonly<Record<string, string | number | boolean>>;
}

export interface WithdrawalExecutionResult {
  readonly outcome: WithdrawalOutcome;
  readonly finalization?: OperationFinalizationRecord | undefined;
}

export interface WithdrawalHostAuthorizationResult {
  readonly status: "approved" | "declined";
  readonly authorizationReference?: string | undefined;
  readonly reasonCode?: string | undefined;
}

export interface WithdrawalHostPostingPort {
  authorize(input: {
    readonly operationId: string;
    readonly amount: CashAmount;
    readonly entryMode: WithdrawalEntryMode;
    readonly protocol: WithdrawalHostProtocol;
    readonly cashPlan?: CashDispensePlan | undefined;
    readonly safeMetadata?: WithdrawalRequest["safeMetadata"];
  }): Promise<WithdrawalHostAuthorizationResult>;
  complete?(input: {
    readonly operationId: string;
    readonly authorizationReference?: string | undefined;
    readonly protocol: WithdrawalHostProtocol;
    readonly outcome: WithdrawalOutcome;
  }): Promise<void>;
}

export interface WithdrawalCashSessionPort {
  readonly id: string;
  readonly phase: CashDeliveryPhase;
  readonly isTerminal: boolean;
  dispense(plan: CashDispensePlan): Promise<void>;
  present(authorization: CashPresentationAuthorization): Promise<void>;
  waitForTake(): Promise<CashDeliveryTerminalResult>;
  abort(trigger: WithdrawalTrigger): Promise<CashDeliveryTerminalResult>;
  exit(trigger: WithdrawalTrigger): Promise<CashDeliveryExitResult>;
}

export interface WithdrawalCashDeliveryPort {
  start(request: StartCashDeliveryRequest): Promise<{
    readonly before: CashInventorySnapshot;
    readonly plan: CashDispensePlan;
    readonly session: WithdrawalCashSessionPort;
  }>;
}

export interface WithdrawalCardCustodyPort {
  returnCard(request: CardCustodyRequest): Promise<CardCustodyResult>;
}

export interface WithdrawalPresentationAuthorizerPort {
  authorize(input: {
    readonly operationId: string;
    readonly cashSessionId: string;
    readonly policy: CashPresentationPolicy;
  }): Promise<CashPresentationAuthorization>;
}

export interface WithdrawalPrePresentGateContext {
  readonly operationId: string;
  readonly cashSessionId: string;
  readonly entryMode: WithdrawalEntryMode;
  readonly amount: CashAmount;
  readonly signal?: AbortSignal | undefined;
}

export interface WithdrawalPrePresentGateResult {
  readonly status: "approved" | "cancelled" | "timedOut" | "rejected";
  readonly reasonCode?: string | undefined;
}

export interface WithdrawalPrePresentGate {
  readonly id: string;
  evaluate(context: WithdrawalPrePresentGateContext): Promise<WithdrawalPrePresentGateResult>;
}

export interface WithdrawalTransactionPort {
  start(request: WithdrawalRequest, policy: WithdrawalPolicy): Promise<void>;
  markAuthorized(operationId: string, authorization: WithdrawalHostAuthorizationResult): Promise<void>;
  finish(outcome: WithdrawalOutcome): Promise<void>;
}

export interface WithdrawalAuditEvent {
  readonly eventId: string;
  readonly operationId: string;
  readonly message: string;
  readonly data: Readonly<Record<string, string | number | boolean>>;
}

export interface WithdrawalAuditPort {
  append(event: WithdrawalAuditEvent): Promise<void>;
}

export interface WithdrawalScopedStatePort {
  reset(operationId: string, reason: string): Promise<void>;
}

export interface WithdrawalRecoveryBarrierPort {
  recover(): Promise<{
    readonly status: "ready" | "recovering" | "intervention";
    readonly safeSummary: Readonly<Record<string, string | number | boolean>>;
  }>;
}

export interface WithdrawalOrchestratorOptions {
  readonly policies: import("./policy").WithdrawalPolicyRegistry;
  readonly prePresentGates: import("./policy").WithdrawalPrePresentGateRegistry;
  readonly host: WithdrawalHostPostingPort;
  readonly cash: WithdrawalCashDeliveryPort;
  readonly card?: WithdrawalCardCustodyPort | undefined;
  readonly presentationAuthorizer: WithdrawalPresentationAuthorizerPort;
  readonly transactions: WithdrawalTransactionPort;
  readonly audit: WithdrawalAuditPort;
  readonly finalization: OperationFinalizationRunner;
  readonly recoveryBarrier?: WithdrawalRecoveryBarrierPort | undefined;
}
