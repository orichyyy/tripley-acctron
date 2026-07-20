export type ProtectionRecoveryClassification = "recovering" | "terminal" | "intervention";

export type ProtectionTerminalCustodyOutcome =
  | "taken"
  | "retracted"
  | "committed"
  | "notMoved"
  | "notAccepted";

export interface HostProtectionStatus {
  readonly resourceGroup: string;
  readonly state: string;
  readonly fencingToken: number;
  readonly operationId: string;
  readonly action: string;
  readonly reason: string;
  readonly configHash: string;
  readonly phase: string;
  readonly custodyOutcome: string;
  readonly deadlineEpochMs?: number | undefined;
  readonly protectionPolicyProfileId: string;
  readonly protectionPolicyProfileVersion: string;
  readonly protectionPolicyProfileHash: string;
}

export interface HostProtectionJournalRecord {
  readonly id: string;
  readonly resourceGroup: string;
  readonly logicalService: string;
  readonly module: string;
  readonly operationId: string;
  readonly fencingToken: number;
  readonly action: string;
  readonly protectionPolicyProfileId: string;
  readonly protectionPolicyProfileVersion: string;
  readonly protectionPolicyProfileHash: string;
  readonly phase: string;
  readonly custodyOutcome?: string | undefined;
  readonly outcome: "intent" | "completed" | "failed" | "intervention" | "acknowledged";
  readonly executionCertainty: string;
  readonly safeDetail: string;
  readonly deadlineEpochMs?: number | undefined;
}

export interface ProtectionRecoveryHostPort {
  getHostEpoch(): Promise<string>;
  protectionStatus(resourceGroup: string): Promise<HostProtectionStatus>;
  protectionJournal(operationId: string): Promise<readonly HostProtectionJournalRecord[]>;
  acknowledgeProtection(input: {
    readonly hostEpoch: string;
    readonly resourceGroup: string;
    readonly operationId: string;
  }): Promise<void>;
}

export interface ProtectionRecoveryResourceGroup {
  readonly id: string;
}

export type ProtectionRecoveryCaseState =
  | "observed"
  | "ackPending"
  | "acknowledged"
  | "intervention";

export interface ProtectionRecoveryCase {
  readonly id: string;
  readonly hostEpoch: string;
  readonly resourceGroup: string;
  readonly operationId: string;
  readonly fencingToken: number;
  readonly phase: string;
  readonly custodyOutcome: string;
  readonly profileId: string;
  readonly profileVersion: string;
  readonly profileHash: string;
  readonly deadlineEpochMs?: number | undefined;
  readonly classification: ProtectionRecoveryClassification;
  readonly state: ProtectionRecoveryCaseState;
  readonly journalRecordIds: readonly string[];
  readonly interventionReason?: string | undefined;
  readonly updatedAt: string;
}

export interface ProtectionRecoveryImportedRecord extends HostProtectionJournalRecord {
  readonly importId: string;
  readonly caseId: string;
  readonly hostEpoch: string;
  readonly importedAt: string;
}

export interface ProtectionRecoveryStorePort {
  getOpenCase(resourceGroup: string): Promise<ProtectionRecoveryCase | null>;
  ingest(input: {
    readonly hostEpoch: string;
    readonly status: HostProtectionStatus;
    readonly classification: ProtectionRecoveryClassification;
    readonly records: readonly HostProtectionJournalRecord[];
    readonly importedAt: string;
  }): Promise<{
    readonly recoveryCase: ProtectionRecoveryCase;
    readonly records: readonly ProtectionRecoveryImportedRecord[];
  }>;
  listImported(caseId: string): Promise<readonly ProtectionRecoveryImportedRecord[]>;
  isProjected(importId: string, projectionId: string): Promise<boolean>;
  markProjected(importId: string, projectionId: string, projectedAt: string): Promise<void>;
  markAckPending(caseId: string, updatedAt: string): Promise<ProtectionRecoveryCase>;
  markAcknowledged(caseId: string, updatedAt: string): Promise<ProtectionRecoveryCase>;
  markIntervention(
    caseId: string,
    reasonCode: string,
    updatedAt: string,
  ): Promise<ProtectionRecoveryCase>;
}

export interface ProtectionRecoveryProjectionPort {
  readonly id: string;
  /** Implementations must make this operation durable and idempotent by idempotencyKey. */
  project(input: {
    readonly idempotencyKey: string;
    readonly recoveryCase: ProtectionRecoveryCase;
    readonly record: ProtectionRecoveryImportedRecord;
  }): Promise<void>;
}

export interface ProtectionRecoveryApplicationPort {
  /** Implementations must reconcile application leases idempotently by idempotencyKey. */
  reconcile(input: {
    readonly idempotencyKey: string;
    readonly classification: ProtectionRecoveryClassification;
    readonly recoveryCase: ProtectionRecoveryCase;
    readonly records: readonly ProtectionRecoveryImportedRecord[];
  }): Promise<void>;
}

export interface ProtectionRecoveryBarrierResult {
  readonly status: "ready" | "recovering" | "intervention";
  readonly safeSummary: Readonly<Record<string, string | number | boolean>>;
}

export const protectionRecoveryCaseId = (
  hostEpoch: string,
  resourceGroup: string,
  operationId: string,
): string => `${hostEpoch}\u001f${resourceGroup}\u001f${operationId}`;

export const protectionRecoveryImportId = (caseId: string, journalRecordId: string): string =>
  `${caseId}\u001f${journalRecordId}`;
