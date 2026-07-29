import type { CashCustodyOutcome, CashDeliveryPhase } from "./cash-contracts";

export type CashRecoveryAuthority = "transaction" | "recovery" | "maintenance";
export type CashRecoveryState =
  | "transactionBound"
  | "transferPending"
  | "recoveryBound"
  | "takeoverPending"
  | "maintenanceBound"
  | "intervention"
  | "closed";

export interface CashRecoveryLeaseRecord {
  readonly id: string;
  readonly operationId: string;
  readonly cashSessionId: string;
  readonly module: "cdm" | "cim" | (string & {});
  readonly logicalService: string;
  readonly ownerInstanceId: string;
  readonly authority: CashRecoveryAuthority;
  readonly state: CashRecoveryState;
  readonly phase: CashDeliveryPhase;
  readonly evidenceSequence: number;
  readonly fencingToken: number;
  readonly pendingFencingToken?: number | undefined;
  readonly hostEpoch?: string | undefined;
  readonly recoveryDeadlineAt: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly outcome?: CashCustodyOutcome | undefined;
  readonly interventionReason?: string | undefined;
}

export interface CashRecoveryLeaseCreateInput {
  readonly id: string;
  readonly operationId: string;
  readonly cashSessionId: string;
  readonly module: CashRecoveryLeaseRecord["module"];
  readonly logicalService: string;
  readonly ownerInstanceId: string;
  readonly fencingToken: number;
  readonly recoveryDeadlineAt: string;
  readonly createdAt: string;
}

export type CashRecoveryLeasePatch = Partial<Pick<
  CashRecoveryLeaseRecord,
  | "authority"
  | "state"
  | "phase"
  | "evidenceSequence"
  | "fencingToken"
  | "pendingFencingToken"
  | "hostEpoch"
  | "ownerInstanceId"
  | "outcome"
  | "interventionReason"
>>;

export interface CashRecoveryLeaseStorePort {
  create(input: CashRecoveryLeaseCreateInput): Promise<CashRecoveryLeaseRecord>;
  get(id: string): Promise<CashRecoveryLeaseRecord | null>;
  listUnresolved(logicalService?: string): Promise<readonly CashRecoveryLeaseRecord[]>;
  nextFencingToken(logicalService: string, minimum: number): Promise<number>;
  compareAndSwap(input: {
    readonly id: string;
    readonly expectedRevision: number;
    readonly expectedOwnerInstanceId?: string | undefined;
    readonly patch: CashRecoveryLeasePatch;
    readonly updatedAt: string;
  }): Promise<CashRecoveryLeaseRecord | null>;
}

export interface CashRecoveryHostLease {
  readonly hostEpoch: string;
  readonly logicalService: string;
  readonly operationId: string;
  readonly fencingToken: number;
  readonly authority: CashRecoveryAuthority | "observation" | "simulatorControl";
  readonly expiresInMs?: number | undefined;
}

export interface CashRecoveryHostLeasePort {
  getHostEpoch(): Promise<string>;
  acquire(input: {
    readonly hostEpoch: string;
    readonly logicalService: string;
    readonly operationId: string;
    readonly fencingToken: number;
    readonly authority: CashRecoveryAuthority;
    readonly ttlMs: number;
  }): Promise<CashRecoveryHostLease>;
  transition(input: {
    readonly hostEpoch: string;
    readonly logicalService: string;
    readonly operationId: string;
    readonly fencingToken: number;
    readonly nextFencingToken: number;
    readonly fromAuthority: CashRecoveryAuthority;
    readonly toAuthority: CashRecoveryAuthority;
    readonly ttlMs: number;
  }): Promise<CashRecoveryHostLease>;
  status(logicalService: string): Promise<CashRecoveryHostLease | null>;
  release(input: {
    readonly hostEpoch: string;
    readonly logicalService: string;
    readonly operationId: string;
    readonly fencingToken: number;
  }): Promise<void>;
}

export type CashRecoveryObservationState =
  | "staged"
  | "presented"
  | "taken"
  | "retracted"
  | "notDispensed"
  | "unknown";

export interface CashRecoveryObservation {
  readonly state: CashRecoveryObservationState;
  readonly safeResultCode?: string | number | undefined;
}

export interface CashRecoveryDevicePort {
  observe(record: CashRecoveryLeaseRecord): Promise<CashRecoveryObservation>;
  retract(record: CashRecoveryLeaseRecord): Promise<CashRecoveryObservation>;
}

export interface CashRecoveryDeviceRegistryPort {
  require(logicalService: string): CashRecoveryDevicePort;
}

export interface CashRecoveryRunResult {
  readonly status: "ready" | "recovering" | "intervention";
  readonly recovered: number;
  readonly unresolved: number;
  readonly deadlineBreaches: number;
  readonly safeSummary: Readonly<Record<string, string | number | boolean>>;
}
