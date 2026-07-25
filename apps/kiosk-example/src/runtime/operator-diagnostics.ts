import {
  createWithdrawalInvestigationRecord,
  type WithdrawalExecutionResult,
  type WithdrawalFailureReason,
  type WithdrawalInvestigationRecord,
  type WithdrawalReason,
  type WithdrawalStatus,
} from "@tripley-kit/web-container-withdrawal-orchestration";

export interface OperatorWithdrawalEvidence {
  readonly operationId: string;
  readonly status: WithdrawalStatus;
  readonly failureReason: WithdrawalFailureReason;
  readonly outcomeReason: WithdrawalReason;
  readonly trigger?: WithdrawalInvestigationRecord["trigger"] | undefined;
  readonly host: {
    readonly protocol: string;
    readonly mode: WithdrawalInvestigationRecord["host"]["protocolMode"];
    readonly status: WithdrawalInvestigationRecord["host"]["status"];
  };
  readonly card: {
    readonly required: boolean;
    readonly status: WithdrawalInvestigationRecord["card"]["status"];
    readonly mediaState?: WithdrawalInvestigationRecord["card"]["mediaState"] | undefined;
    readonly authorityReleased?: boolean | undefined;
  };
  readonly cash: {
    readonly dispense: WithdrawalInvestigationRecord["cash"]["dispense"];
    readonly present: WithdrawalInvestigationRecord["cash"]["present"];
    readonly custody: WithdrawalInvestigationRecord["cash"]["custody"];
    readonly dispensed: boolean;
    readonly presented: boolean;
    readonly taken: boolean;
    readonly retracted: boolean;
    readonly reconciliationRequired: boolean;
    readonly beforeSnapshotId?: string | undefined;
    readonly afterSnapshotId?: string | undefined;
  };
  readonly requiresManualReconciliation: boolean;
}

export interface WithdrawalDiagnosticsSnapshot {
  readonly revision: number;
  readonly latest?: OperatorWithdrawalEvidence | undefined;
}

export interface WithdrawalDiagnosticsSource {
  snapshot(): WithdrawalDiagnosticsSnapshot;
  subscribe(listener: (snapshot: WithdrawalDiagnosticsSnapshot) => void): () => void;
}

export interface WithdrawalDiagnosticsPort extends WithdrawalDiagnosticsSource {
  publish(result: WithdrawalExecutionResult): OperatorWithdrawalEvidence;
}

export class WithdrawalDiagnosticsStore implements WithdrawalDiagnosticsPort {
  readonly #listeners = new Set<(snapshot: WithdrawalDiagnosticsSnapshot) => void>();
  #state: WithdrawalDiagnosticsSnapshot = Object.freeze({ revision: 0 });

  public snapshot(): WithdrawalDiagnosticsSnapshot {
    return this.#state;
  }

  public subscribe(listener: (snapshot: WithdrawalDiagnosticsSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  public publish(result: WithdrawalExecutionResult): OperatorWithdrawalEvidence {
    const latest = projectEvidence(createWithdrawalInvestigationRecord(result.outcome));
    this.#state = Object.freeze({
      latest,
      revision: this.#state.revision + 1,
    });
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
    return latest;
  }
}

const projectEvidence = (
  record: WithdrawalInvestigationRecord,
): OperatorWithdrawalEvidence =>
  Object.freeze({
    card: Object.freeze({
      authorityReleased: record.card.authorityReleased,
      mediaState: record.card.mediaState,
      required: record.card.required,
      status: record.card.status,
    }),
    cash: Object.freeze({
      afterSnapshotId: record.cash.afterSnapshotId,
      beforeSnapshotId: record.cash.beforeSnapshotId,
      custody: record.cash.custody,
      dispense: record.cash.dispense,
      dispensed: record.cash.dispensed,
      present: record.cash.present,
      presented: record.cash.presented,
      reconciliationRequired: record.cash.reconciliationRequired,
      retracted: record.cash.retracted,
      taken: record.cash.taken,
    }),
    failureReason: record.failureReason,
    host: Object.freeze({
      mode: record.host.protocolMode,
      protocol: `${record.host.protocolId}@${record.host.protocolVersion}`,
      status: record.host.status,
    }),
    operationId: record.operationId,
    outcomeReason: record.outcomeReason,
    requiresManualReconciliation: record.requiresManualReconciliation,
    status: record.outcomeStatus,
    ...(record.trigger ? { trigger: record.trigger } : {}),
  });
