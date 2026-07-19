export type CashAcceptancePhase =
  | "starting" | "accepting" | "escrowed" | "authorizing"
  | "committing" | "rolling-back" | "retracting" | "completed" | "failed";

export type CashCustody =
  | "customer" | "transport" | "escrow" | "cash-unit"
  | "presented" | "retract-unit" | "unknown";

export interface CashNoteCount { readonly noteId: number; readonly count: number }

export interface CashAcceptanceSnapshot {
  readonly revision: number;
  readonly hash: string;
  readonly notes: readonly CashNoteCount[];
  readonly refusedCount: number;
  readonly capturedAt: string;
}

export interface CashAcceptanceAuthorization {
  readonly operationId: string;
  readonly revision: number;
  readonly snapshotHash: string;
  readonly approved: boolean;
  readonly reason?: string | undefined;
}

export interface CashAcceptanceResult {
  readonly operationId: string;
  readonly phase: CashAcceptancePhase;
  readonly reason: "committed" | "cancelled" | "timeout" | "authorization-declined"
    | "authorization-stale" | "returned" | "retracted" | "device-error" | "fenced" | "recovery-required";
  readonly committed: boolean;
  readonly snapshot?: CashAcceptanceSnapshot | undefined;
  readonly portions: readonly {
    readonly portionId: string;
    readonly custody: CashCustody;
    readonly notes: readonly CashNoteCount[];
    readonly reason?: string | undefined;
  }[];
  readonly safeSummary: Readonly<Record<string, unknown>>;
}

export interface CashAcceptancePolicy {
  readonly inputPosition: number;
  readonly outputPosition: number;
  readonly startTimeoutMs: number;
  readonly acceptTimeoutMs: number;
  readonly takeTimeoutMs: number;
  readonly retractTimeoutMs: number;
  readonly notTakenAction: "retract" | "intervention";
  readonly retractArea?: number | undefined;
  readonly retractIndex?: number | undefined;
}

export interface CashAcceptanceStartRequest {
  readonly operationId: string;
  readonly logicalService: string;
  readonly resourceGroup: string;
  readonly policy: CashAcceptancePolicy;
  readonly signal?: AbortSignal | undefined;
}

export interface CashAcceptanceLeaseSession {
  readonly fencingToken: number;
  release(): Promise<void>;
}

export interface CashAcceptanceLeasePort {
  acquire(request: {
    readonly operationId: string;
    readonly logicalService: string;
    readonly resourceGroup: string;
    readonly authority: "transaction";
  }): Promise<CashAcceptanceLeaseSession>;
}

export interface CashAcceptanceAuthorizer {
  authorize(snapshot: CashAcceptanceSnapshot): Promise<CashAcceptanceAuthorization>;
}

export interface CashAcceptanceEntryGate {
  assertCanStart(request: CashAcceptanceStartRequest): Promise<void>;
}

export interface CashAcceptanceEvidencePort {
  append(event: {
    readonly operationId: string;
    readonly logicalService: string;
    readonly phase: CashAcceptancePhase;
    readonly event: string;
    readonly at: string;
    readonly safeDetails?: Readonly<Record<string, unknown>> | undefined;
  }): Promise<void>;
}

export interface CashAcceptanceRecord {
  readonly operationId: string;
  readonly logicalService: string;
  readonly phase: CashAcceptancePhase;
  readonly revision: number;
  readonly snapshotHash?: string | undefined;
  readonly authorizationRevision?: number | undefined;
  readonly authorizationHash?: string | undefined;
  readonly physicalCommitDispatched: boolean;
  readonly terminalReason?: CashAcceptanceResult["reason"] | undefined;
  readonly updatedAt: string;
}

export interface CashAcceptanceStore {
  create(record: CashAcceptanceRecord): Promise<void>;
  update(record: CashAcceptanceRecord): Promise<void>;
  get(operationId: string): Promise<CashAcceptanceRecord | undefined>;
  listUnresolved(): Promise<readonly CashAcceptanceRecord[]>;
}

export interface CimCashInClient {
  cashInStart(request: { inputPosition: number; outputPosition: number; timeoutMs: number }): Promise<void>;
  cashIn(request: { timeoutMs: number }): Promise<{ status: string; refusedCount?: number | undefined; notes?: readonly CashNoteCount[] | undefined }>;
  getCashInStatus(): Promise<{ status: string; refusedCount?: number | undefined; notes?: readonly CashNoteCount[] | undefined }>;
  cashInEnd(request: { timeoutMs: number }): Promise<void>;
  cashInRollback(request: { timeoutMs: number }): Promise<void>;
  waitForCashTaken(request: { timeoutMs: number; signal?: AbortSignal | undefined }): Promise<boolean>;
  retract(request: { outputPosition: number; retractArea?: number | undefined; index?: number | undefined; timeoutMs: number }): Promise<void>;
}

export interface CashAcceptanceSession {
  readonly operationId: string;
  readonly phase: CashAcceptancePhase;
  acceptBatch(): Promise<CashAcceptanceSnapshot>;
  authorize(authorizer: CashAcceptanceAuthorizer): Promise<CashAcceptanceAuthorization>;
  commit(authorization: CashAcceptanceAuthorization): Promise<CashAcceptanceResult>;
  abort(reason: "cancelled" | "timeout"): Promise<CashAcceptanceResult>;
}
