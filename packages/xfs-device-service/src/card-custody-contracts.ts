import type { XfsCardMediaState } from "./types";

export type CardCustodyStatus =
  | "inside"
  | "presented"
  | "returned"
  | "retained"
  | "cancelled"
  | "intervention";

export type CardCustodyReason =
  | "taken"
  | "retained-by-policy"
  | "take-timeout"
  | "user-cancelled"
  | "operation-timeout"
  | "node-exit"
  | "device-loss"
  | "eject-failed"
  | "retain-failed"
  | "authority-rejected"
  | "media-jammed"
  | "recovery-inside"
  | "recovery-presented"
  | "custody-unknown"
  | "evidence-write-failed";

export type CardCustodyInterruptReason =
  | "user-cancelled"
  | "operation-timeout"
  | "node-exit"
  | "device-loss";

export type CardCustodyResolutionAction = "retain" | "leave-presented" | "intervention";

export interface CardCustodyPolicy {
  readonly id: string;
  readonly version: string;
  readonly takeTimeoutMs: number;
  readonly pollIntervalMs: number;
  readonly takeTimeoutAction: CardCustodyResolutionAction;
  readonly interruptActions?: Partial<
    Readonly<Record<CardCustodyInterruptReason, CardCustodyResolutionAction>>
  > | undefined;
}

export interface CardCustodyAuthority {
  readonly hostEpoch: string;
  readonly fencingToken: number;
}

export interface CardCustodyResult {
  readonly operationId: string;
  readonly logicalService: string;
  readonly status: CardCustodyStatus;
  readonly reason: CardCustodyReason;
  readonly mediaState: XfsCardMediaState;
  readonly authority?: CardCustodyAuthority | undefined;
  readonly authorityReleased: boolean;
  readonly failureCode?: string | undefined;
  readonly safeSummary: Readonly<Record<string, string | number | boolean>>;
}

export type CardCustodyEvidenceAction =
  | "authority-acquired"
  | "authority-released"
  | "authority-release-failed"
  | "eject-requested"
  | "eject-completed"
  | "retain-requested"
  | "retain-completed"
  | "media-observed"
  | "terminal";

export interface CardCustodyEvidence {
  readonly kind: "card.custody";
  readonly sequence: number;
  readonly occurredAt: string;
  readonly operationId: string;
  readonly logicalService: string;
  readonly action: CardCustodyEvidenceAction;
  readonly mediaState?: XfsCardMediaState | undefined;
  readonly status?: CardCustodyStatus | undefined;
  readonly reason?: CardCustodyReason | undefined;
  readonly hostEpoch?: string | undefined;
  readonly fencingToken?: number | undefined;
  readonly failureCode?: string | undefined;
  readonly safeSummary: Readonly<Record<string, string | number | boolean>>;
}

export interface CardCustodyEvidenceSink {
  append(evidence: CardCustodyEvidence): Promise<void>;
}

export type CardCustodyAuthorityMode = "transaction" | "recovery" | "observation";

export interface CardCustodyLeaseSession extends CardCustodyAuthority {
  readonly authority: CardCustodyAuthorityMode;
  transitionToRecovery(): Promise<void>;
  release(): Promise<void>;
}

export interface CardCustodyLeasePort {
  acquire(request: {
    readonly operationId: string;
    readonly logicalService: string;
    readonly resourceGroup: string;
    readonly authority: CardCustodyAuthorityMode;
  }): Promise<CardCustodyLeaseSession>;
}

export interface CardCustodyRequest {
  readonly operationId: string;
  readonly policyId: string;
  readonly authority?: CardCustodyLeaseSession | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly interruptReason?: CardCustodyInterruptReason | undefined;
}

export interface CardCustodyReconcileRequest {
  readonly operationId: string;
}
