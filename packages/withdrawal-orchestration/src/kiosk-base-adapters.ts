import type {
  AuditJournalService,
  TransactionRepository,
  TransactionStatus,
} from "@tripley-kit/web-container-kiosk-base";
import type { JsonValue, Metadata } from "@tripley-kit/web-container-types";

import type {
  WithdrawalAuditPort,
  WithdrawalHostAuthorizationResult,
  WithdrawalOutcome,
  WithdrawalPolicy,
  WithdrawalRequest,
  WithdrawalTransactionPort,
} from "./contracts";

export const createKioskBaseWithdrawalTransactionAdapter = (
  repository: TransactionRepository,
  now: () => Date = () => new Date(),
): WithdrawalTransactionPort => ({
  start: async (request: WithdrawalRequest, policy: WithdrawalPolicy) => {
    if (await repository.get(request.operationId)) return;
    await repository.create({
      amount: request.amount.minorUnits,
      businessType: "withdrawal",
      currency: request.amount.currency,
      id: request.operationId,
      metadata: {
        entryMode: request.entryMode,
        policyId: policy.id,
        policyVersion: policy.version,
        ...(request.safeMetadata ?? {}),
      },
    });
  },
  markAuthorized: async (
    operationId: string,
    authorization: WithdrawalHostAuthorizationResult,
  ) => repository.updateStatus(operationId, "authorized", {
    ...(authorization.authorizationReference
      ? { resultCode: authorization.authorizationReference }
      : {}),
  }),
  finish: async (outcome: WithdrawalOutcome) => {
    const status = transactionStatus(outcome);
    await repository.updateStatus(outcome.operationId, status, {
      ...(status === "completed" ? { completedAt: now().toISOString() } : { failedAt: now().toISOString() }),
      metadata: outcomeMetadata(outcome),
      resultCode: outcome.reason,
      resultMessage: outcome.status,
    });
  },
});

export const createKioskBaseWithdrawalAuditAdapter = (
  audit: AuditJournalService,
): WithdrawalAuditPort => ({
  append: async (event) => {
    await audit.append({
      businessType: "withdrawal",
      data: event.data as unknown as JsonValue,
      eventId: event.eventId,
      message: event.message,
      transactionId: event.operationId,
    });
  },
});

const transactionStatus = (outcome: WithdrawalOutcome): TransactionStatus => {
  if (outcome.status === "completed") return "completed";
  if (outcome.status === "cancelled" || outcome.status === "timedOut") return "cancelled";
  return "failed";
};

const outcomeMetadata = (outcome: WithdrawalOutcome): Metadata => ({
  withdrawalStatus: outcome.status,
  withdrawalReason: outcome.reason,
  hostAuthorizationStatus: outcome.host.status,
  cashDispense: outcome.cash.dispense,
  cashPresent: outcome.cash.present,
  cashCustody: outcome.cash.custody,
  cashDispensed: outcome.cash.dispensed,
  cashPresented: outcome.cash.presented,
  cashTaken: outcome.cash.taken,
  cashRetracted: outcome.cash.retracted,
  cashReconciliationRequired: outcome.cash.reconciliationRequired,
  cardRequired: outcome.card.required,
  cardStatus: outcome.card.status,
  ...(outcome.card.reason ? { cardReason: outcome.card.reason } : {}),
  ...(outcome.cash.beforeSnapshotId ? { cashBeforeSnapshotId: outcome.cash.beforeSnapshotId } : {}),
  ...(outcome.cash.afterSnapshotId ? { cashAfterSnapshotId: outcome.cash.afterSnapshotId } : {}),
  ...(outcome.cash.recoveryTransferId ? { cashRecoveryTransferId: outcome.cash.recoveryTransferId } : {}),
  ...(outcome.trigger ? { withdrawalTrigger: outcome.trigger } : {}),
});
