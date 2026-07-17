import type { DeviceLease, DeviceLockManager } from "@tripley/web-container-device-core";

export type CashCustodyOutcome = "taken" | "retracted" | "notDispensed" | "custodyUnknown";
export type CashDeliveryPhase =
  | "planning"
  | "planned"
  | "dispensing"
  | "staged"
  | "presenting"
  | "awaitingTake"
  | "retracting"
  | "reconciling"
  | "terminal";
export type CashEvidenceCertainty = "observed" | "deviceReported" | "inferred" | "unknown";

export interface CashAmount {
  readonly currency: string;
  readonly minorUnits: number;
}

export interface CashUnitObservation {
  readonly logicalSlot: number;
  readonly physicalCassetteId?: string | undefined;
  readonly physicalPosition?: string | undefined;
  readonly type: number;
  readonly currency: string;
  readonly denominationMinorUnits: number;
  readonly count: number;
  readonly rejectCount: number;
  readonly dispensedCount: number;
  readonly presentedCount: number;
  readonly retractedCount: number;
  readonly status: number;
}

export interface CashInventorySnapshot {
  readonly id: string;
  readonly operationId: string;
  readonly cashSessionId: string;
  readonly logicalService: string;
  readonly boundary: "before" | "after" | "recovery";
  readonly capturedAt: string;
  readonly revision: string;
  readonly source: "device";
  readonly certainty: "observed";
  readonly units: readonly CashUnitObservation[];
}

export interface CashDispensePlan {
  readonly id: string;
  readonly operationId: string;
  readonly cashSessionId: string;
  readonly logicalService: string;
  readonly sessionGeneration: number;
  readonly cashUnitRevision: string;
  readonly policyVersion: string;
  readonly expiresAt: number;
  readonly denomination: {
    readonly currencyId: string;
    readonly amount: number;
    readonly values: Uint8Array;
    readonly cashBox: number;
  };
}

export interface CashOperationEvidence {
  readonly operationId: string;
  readonly cashSessionId: string;
  readonly sequence: number;
  readonly wallTime: string;
  readonly monotonicTime: number;
  readonly phase: CashDeliveryPhase;
  readonly kind: string;
  readonly source: "flow" | "device" | "recovery" | "policy";
  readonly certainty: CashEvidenceCertainty;
  readonly trigger?: "cancel" | "timeout" | "interrupt" | "routeExit" | "runtimeShutdown";
  readonly safeResultCode?: string | number | undefined;
  readonly safeDetails?: Readonly<Record<string, unknown>> | undefined;
}

export interface DurableEvidenceReceipt {
  readonly id: string;
  readonly persistedAt: string;
}

export interface OperationEvidenceRecorderPort {
  recordBeforeMovement(input: {
    readonly evidence: CashOperationEvidence;
    readonly snapshot: CashInventorySnapshot;
    readonly ejProjection: Readonly<Record<string, unknown>>;
  }): Promise<DurableEvidenceReceipt>;
  append(evidence: CashOperationEvidence): Promise<DurableEvidenceReceipt>;
  recordAfterSnapshot(snapshot: CashInventorySnapshot): Promise<DurableEvidenceReceipt>;
}

export interface EmergencyEvidenceSpoolPort {
  append(evidence: CashOperationEvidence): Promise<void>;
}

export interface CashRecoveryLease {
  readonly id: string;
  readonly operationId: string;
  readonly cashSessionId: string;
  readonly ownerInstanceId: string;
  readonly fencingToken: number;
}

export interface CashRecoveryLeasePort {
  hasUnresolved(logicalService: string): Promise<boolean>;
  acquire(input: {
    readonly operationId: string;
    readonly cashSessionId: string;
    readonly logicalService: string;
    readonly ownerInstanceId: string;
  }): Promise<CashRecoveryLease>;
  update(lease: CashRecoveryLease, phase: CashDeliveryPhase, sequence: number): Promise<void>;
  close(lease: CashRecoveryLease, outcome: CashCustodyOutcome): Promise<void>;
}

export interface CashDeliveryDependencies {
  readonly deviceLocks: DeviceLockManager;
  readonly evidence: OperationEvidenceRecorderPort;
  readonly emergencySpool: EmergencyEvidenceSpoolPort;
  readonly recoveryLeases: CashRecoveryLeasePort;
  readonly now?: () => Date;
  readonly monotonicNow?: () => number;
  readonly idFactory?: () => string;
}

export interface HeldCashSessionResources {
  readonly deviceLease: DeviceLease;
  readonly recoveryLease: CashRecoveryLease;
  readonly hostCommandLease: {
    readonly hostEpoch: string;
    readonly logicalService: string;
    readonly operationId: string;
    readonly fencingToken: number;
  };
}
