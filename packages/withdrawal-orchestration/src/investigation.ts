import type {
  CashInventorySnapshot,
  CashUnitObservation,
} from "@tripley-kit/web-container-xfs-device-service";

import type { WithdrawalOutcome, WithdrawalReason } from "./contracts";

export type WithdrawalFailureReason =
  | "completed"
  | "cancelled"
  | "timeout"
  | "hostDeclined"
  | "hostUnavailable"
  | "dispenseFailed"
  | "cashPresentationFailed"
  | "cardNotTaken"
  | "cashNotTaken"
  | "custodyUnknown"
  | "recoveryBlocked"
  | "failed";

export interface WithdrawalInvestigationInventory {
  readonly id: string;
  readonly boundary: CashInventorySnapshot["boundary"];
  readonly capturedAt: string;
  readonly logicalService: string;
  readonly revision: string;
  readonly units: readonly CashUnitObservation[];
}

export interface WithdrawalInvestigationEvidence {
  readonly before?: CashInventorySnapshot | undefined;
  readonly after?: CashInventorySnapshot | undefined;
}

export interface WithdrawalInvestigationRecord {
  readonly kind: "withdrawal.investigation";
  readonly operationId: string;
  readonly failureReason: WithdrawalFailureReason;
  readonly outcomeReason: WithdrawalReason;
  readonly outcomeStatus: WithdrawalOutcome["status"];
  readonly trigger?: WithdrawalOutcome["trigger"] | undefined;
  readonly host: WithdrawalOutcome["host"];
  readonly card: WithdrawalOutcome["card"];
  readonly cash: WithdrawalOutcome["cash"] & {
    readonly inventory: {
      readonly before?: WithdrawalInvestigationInventory | undefined;
      readonly after?: WithdrawalInvestigationInventory | undefined;
    };
  };
  readonly requiresManualReconciliation: boolean;
  readonly safeSummary: Readonly<Record<string, string | number | boolean>>;
}

export interface WithdrawalInvestigationRenderer<TOutput> {
  readonly id: string;
  render(record: WithdrawalInvestigationRecord): TOutput;
}

export function createWithdrawalInvestigationRecord(
  outcome: WithdrawalOutcome,
  evidence: WithdrawalInvestigationEvidence = {},
): WithdrawalInvestigationRecord {
  assertSnapshot(outcome.cash.beforeSnapshotId, evidence.before, "before");
  assertSnapshot(outcome.cash.afterSnapshotId, evidence.after, "after");
  const failureReason = classifyWithdrawalFailure(outcome.reason);
  const requiresManualReconciliation =
    outcome.cash.reconciliationRequired ||
    failureReason === "custodyUnknown" ||
    outcome.card.status === "intervention";
  const inventory = Object.freeze({
    ...(evidence.before ? { before: projectInventory(evidence.before) } : {}),
    ...(evidence.after ? { after: projectInventory(evidence.after) } : {}),
  });
  return Object.freeze({
    card: Object.freeze({ ...outcome.card }),
    cash: Object.freeze({ ...outcome.cash, inventory }),
    failureReason,
    host: Object.freeze({ ...outcome.host }),
    kind: "withdrawal.investigation" as const,
    operationId: outcome.operationId,
    outcomeReason: outcome.reason,
    outcomeStatus: outcome.status,
    requiresManualReconciliation,
    safeSummary: Object.freeze({
      ...outcome.safeSummary,
      failureReason,
      requiresManualReconciliation,
      ...(outcome.cash.beforeSnapshotId
        ? { cashBeforeSnapshotId: outcome.cash.beforeSnapshotId }
        : {}),
      ...(outcome.cash.afterSnapshotId
        ? { cashAfterSnapshotId: outcome.cash.afterSnapshotId }
        : {}),
    }),
    ...(outcome.trigger ? { trigger: outcome.trigger } : {}),
  });
}

export function classifyWithdrawalFailure(
  reason: WithdrawalReason,
): WithdrawalFailureReason {
  switch (reason) {
    case "completed":
      return "completed";
    case "user-cancelled":
    case "verification-cancelled":
    case "card-cancelled":
      return "cancelled";
    case "operation-timeout":
    case "verification-timeout":
      return "timeout";
    case "host-declined":
      return "hostDeclined";
    case "host-unavailable":
      return "hostUnavailable";
    case "cash-start-failed":
    case "cash-dispense-failed":
      return "dispenseFailed";
    case "cash-presentation-not-authorized":
    case "cash-present-failed":
      return "cashPresentationFailed";
    case "card-take-timeout":
      return "cardNotTaken";
    case "cash-take-timeout":
      return "cashNotTaken";
    case "cash-custody-unknown":
    case "card-custody-unresolved":
      return "custodyUnknown";
    case "recovery-barrier-blocked":
      return "recoveryBlocked";
    case "verification-rejected":
    case "unexpected-failure":
      return "failed";
  }
}

function assertSnapshot(
  expectedId: string | undefined,
  snapshot: CashInventorySnapshot | undefined,
  boundary: "before" | "after",
): void {
  if (!snapshot) return;
  if (!expectedId || snapshot.id !== expectedId || snapshot.boundary !== boundary) {
    throw new Error(
      `Withdrawal ${boundary} inventory does not match outcome evidence`,
    );
  }
}

function projectInventory(
  snapshot: CashInventorySnapshot,
): WithdrawalInvestigationInventory {
  return Object.freeze({
    boundary: snapshot.boundary,
    capturedAt: snapshot.capturedAt,
    id: snapshot.id,
    logicalService: snapshot.logicalService,
    revision: snapshot.revision,
    units: Object.freeze(snapshot.units.map((unit) => Object.freeze({ ...unit }))),
  });
}
