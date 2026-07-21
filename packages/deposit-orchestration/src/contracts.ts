import type {
  OperationFinalizationRecord,
  OperationFinalizationRunner,
} from "@tripley-kit/web-container-kiosk-runtime";
import type {
  CashAcceptanceAuthorization,
  CashAcceptanceAuthorizer,
  CashAcceptancePolicy,
  CashAcceptanceResult,
  CashAcceptanceSession,
  CashAcceptanceSnapshot,
  CashAcceptanceStartRequest,
  CashCustody,
  CashNoteCount,
} from "@tripley-kit/web-container-xfs-device-service";

export type DepositHostProtocolMode = "authorization-only" | "authorization-then-completion";

export interface DepositHostProtocol {
  readonly id: string;
  readonly version: string;
  readonly mode: DepositHostProtocolMode;
}

export interface DepositPolicy {
  readonly id: string;
  readonly version: string;
  readonly logicalService: string;
  readonly resourceGroup: string;
  readonly maxBatches: number;
  readonly reviewGateId: string;
  readonly acceptancePolicy: CashAcceptancePolicy;
  readonly hostProtocol: DepositHostProtocol;
}

export interface DepositRequest {
  readonly operationId: string;
  readonly policyId: string;
  readonly signal?: AbortSignal | undefined;
  readonly safeMetadata?: Readonly<Record<string, string | number | boolean>> | undefined;
}

export type DepositStatus =
  | "completed"
  | "cancelled"
  | "timedOut"
  | "declined"
  | "failed"
  | "intervention";

export type DepositReason =
  | "committed"
  | "recovery-barrier-blocked"
  | "inventory-before-failed"
  | "inventory-after-failed"
  | "customer-cancelled"
  | "customer-timeout"
  | "review-rejected"
  | "batch-limit-reached"
  | "cash-acceptance-start-failed"
  | "cash-acceptance-failed"
  | "host-declined"
  | "host-unavailable"
  | "physical-commit-unknown"
  | "returned"
  | "retracted"
  | "returned-media-unresolved"
  | "refused-media-unresolved"
  | "unexpected-failure";

export type DepositTrigger = "cancel" | "timeout" | "interrupt";

export interface DepositInventorySnapshot {
  readonly id: string;
  readonly operationId: string;
  readonly logicalService: string;
  readonly boundary: "before" | "after";
  readonly revision: string;
  readonly capturedAt: string;
  readonly safeSummary: Readonly<Record<string, string | number | boolean>>;
}

export interface DepositInventoryPort {
  capture(input: {
    readonly operationId: string;
    readonly logicalService: string;
    readonly resourceGroup: string;
    readonly boundary: DepositInventorySnapshot["boundary"];
  }): Promise<DepositInventorySnapshot>;
}

export interface DepositHostAuthorizationResult extends CashAcceptanceAuthorization {
  readonly authorizationReference?: string | undefined;
  readonly reasonCode?: string | undefined;
}

export interface DepositHostPostingPort {
  authorize(input: {
    readonly operationId: string;
    readonly snapshot: CashAcceptanceSnapshot;
    readonly protocol: DepositHostProtocol;
    readonly safeMetadata?: DepositRequest["safeMetadata"];
  }): Promise<DepositHostAuthorizationResult>;
  complete?(input: {
    readonly operationId: string;
    readonly authorizationReference?: string | undefined;
    readonly protocol: DepositHostProtocol;
    readonly outcome: DepositOutcome;
  }): Promise<void>;
}

export interface DepositCashAcceptancePort {
  start(request: CashAcceptanceStartRequest): Promise<CashAcceptanceSession>;
}

export type DepositReviewDecision = "accept-more" | "confirm" | "cancelled" | "timedOut" | "rejected";

export interface DepositEscrowReviewContext {
  readonly operationId: string;
  readonly batchNumber: number;
  readonly maxBatches: number;
  readonly snapshot: CashAcceptanceSnapshot;
  readonly signal?: AbortSignal | undefined;
}

export interface DepositEscrowReviewResult {
  readonly decision: DepositReviewDecision;
  readonly reasonCode?: string | undefined;
}

export interface DepositEscrowReviewGate {
  readonly id: string;
  evaluate(context: DepositEscrowReviewContext): Promise<DepositEscrowReviewResult>;
}

export interface DepositReturnedMediaResolution {
  readonly status: "taken" | "retracted" | "presented" | "unknown";
  readonly reasonCode?: string | undefined;
}

export interface DepositReturnedMediaPort {
  resolveRefused(input: {
    readonly operationId: string;
    readonly logicalService: string;
    readonly refusedCount: number;
    readonly signal?: AbortSignal | undefined;
  }): Promise<DepositReturnedMediaResolution>;
}

export interface DepositHostFacts {
  readonly protocolId: string;
  readonly protocolVersion: string;
  readonly protocolMode: DepositHostProtocolMode;
  readonly status: "not-requested" | "approved" | "declined" | "unavailable";
  readonly authorizationReference?: string | undefined;
  readonly reasonCode?: string | undefined;
}

export interface DepositEscrowFacts {
  readonly batchCount: number;
  readonly revision?: number | undefined;
  readonly snapshotHash?: string | undefined;
  readonly acceptedNoteCount: number;
  readonly refusedCount: number;
}

export interface DepositPortionFacts {
  readonly kind: "accepted" | "refused" | "returned";
  readonly portionId: string;
  readonly custody: CashCustody;
  readonly noteCount: number;
  readonly notes?: readonly CashNoteCount[] | undefined;
  readonly reason?: string | undefined;
}

export interface DepositPhysicalFacts {
  readonly commit: "not-requested" | "dispatched" | "completed" | "execution-unknown";
  readonly committed: boolean;
  readonly resultReason?: CashAcceptanceResult["reason"] | undefined;
  readonly reconciliationRequired: boolean;
}

export interface DepositInventoryFacts {
  readonly beforeSnapshotId?: string | undefined;
  readonly afterSnapshotId?: string | undefined;
  readonly beforeRevision?: string | undefined;
  readonly afterRevision?: string | undefined;
  readonly afterCaptureFailed: boolean;
}

export interface DepositOutcome {
  readonly kind: "deposit.outcome";
  readonly operationId: string;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly status: DepositStatus;
  readonly reason: DepositReason;
  readonly trigger?: DepositTrigger | undefined;
  readonly host: DepositHostFacts;
  readonly escrow: DepositEscrowFacts;
  readonly physical: DepositPhysicalFacts;
  readonly inventory: DepositInventoryFacts;
  readonly portions: readonly DepositPortionFacts[];
  readonly safeSummary: Readonly<Record<string, string | number | boolean>>;
}

export interface DepositExecutionResult {
  readonly outcome: DepositOutcome;
  readonly finalization?: OperationFinalizationRecord | undefined;
}

export interface DepositTransactionPort {
  start(request: DepositRequest, policy: DepositPolicy): Promise<void>;
  markEscrow(operationId: string, snapshot: CashAcceptanceSnapshot): Promise<void>;
  markAuthorized(operationId: string, authorization: DepositHostAuthorizationResult): Promise<void>;
  finish(outcome: DepositOutcome): Promise<void>;
}

export interface DepositAuditEvent {
  readonly eventId: string;
  readonly operationId: string;
  readonly message: string;
  readonly data: Readonly<Record<string, string | number | boolean>>;
}

export interface DepositAuditPort {
  append(event: DepositAuditEvent): Promise<void>;
}

export interface DepositScopedStatePort {
  reset(operationId: string, reason: string): Promise<void>;
}

export interface DepositRecoveryBarrierPort {
  recover(): Promise<{
    readonly status: "ready" | "recovering" | "intervention";
    readonly safeSummary: Readonly<Record<string, string | number | boolean>>;
  }>;
}

export interface DepositOrchestratorOptions {
  readonly policies: import("./policy").DepositPolicyRegistry;
  readonly reviewGates: import("./policy").DepositEscrowReviewGateRegistry;
  readonly cash: DepositCashAcceptancePort;
  readonly host: DepositHostPostingPort;
  readonly inventory: DepositInventoryPort;
  readonly returnedMedia?: DepositReturnedMediaPort | undefined;
  readonly transactions: DepositTransactionPort;
  readonly audit: DepositAuditPort;
  readonly finalization: OperationFinalizationRunner;
  readonly recoveryBarrier?: DepositRecoveryBarrierPort | undefined;
}

export type DepositSessionAuthorizer = CashAcceptanceAuthorizer;
