import type {
  AuditJournalService,
  TransactionRepository,
  TransactionStatus,
} from "@tripley-kit/web-container-kiosk-base";
import type { JsonValue, Metadata } from "@tripley-kit/web-container-types";

import type {
  DepositAuditPort,
  DepositHostAuthorizationResult,
  DepositOutcome,
  DepositPolicy,
  DepositRequest,
  DepositTransactionPort,
} from "./contracts";

export const createKioskBaseDepositTransactionAdapter = (
  repository: TransactionRepository,
  now: () => Date = () => new Date(),
): DepositTransactionPort => ({
  start: async (request: DepositRequest, policy: DepositPolicy) => {
    if (await repository.get(request.operationId)) return;
    await repository.create({
      businessType: "deposit",
      id: request.operationId,
      metadata: {
        logicalService: policy.logicalService,
        policyId: policy.id,
        policyVersion: policy.version,
        resourceGroup: policy.resourceGroup,
        ...(request.safeMetadata ?? {}),
      },
    });
  },
  markEscrow: async (operationId, snapshot) => repository.updateStatus(operationId, "started", {
    metadata: {
      escrowAcceptedNoteCount: snapshot.notes.reduce((sum, note) => sum + note.count, 0),
      escrowRefusedCount: snapshot.refusedCount,
      escrowRevision: snapshot.revision,
      escrowSnapshotHash: snapshot.hash,
    },
  }),
  markAuthorized: async (
    operationId: string,
    authorization: DepositHostAuthorizationResult,
  ) => repository.updateStatus(operationId, "authorized", {
    ...(authorization.authorizationReference
      ? { resultCode: authorization.authorizationReference }
      : {}),
  }),
  finish: async (outcome: DepositOutcome) => {
    const status = transactionStatus(outcome);
    await repository.updateStatus(outcome.operationId, status, {
      ...(status === "completed" ? { completedAt: now().toISOString() } : { failedAt: now().toISOString() }),
      metadata: outcomeMetadata(outcome),
      resultCode: outcome.reason,
      resultMessage: outcome.status,
    });
  },
});

export const createKioskBaseDepositAuditAdapter = (
  audit: AuditJournalService,
): DepositAuditPort => ({
  append: async (event) => {
    await audit.append({
      businessType: "deposit",
      data: event.data as unknown as JsonValue,
      eventId: event.eventId,
      message: event.message,
      transactionId: event.operationId,
    });
  },
});

const transactionStatus = (outcome: DepositOutcome): TransactionStatus => {
  if (outcome.status === "completed") return "completed";
  if (outcome.status === "cancelled" || outcome.status === "timedOut") return "cancelled";
  return "failed";
};

const outcomeMetadata = (outcome: DepositOutcome): Metadata => ({
  depositStatus: outcome.status,
  depositReason: outcome.reason,
  hostAuthorizationStatus: outcome.host.status,
  escrowBatchCount: outcome.escrow.batchCount,
  escrowAcceptedNoteCount: outcome.escrow.acceptedNoteCount,
  escrowRefusedCount: outcome.escrow.refusedCount,
  physicalCommit: outcome.physical.commit,
  physicalCommitted: outcome.physical.committed,
  reconciliationRequired: outcome.physical.reconciliationRequired,
  portionCount: outcome.portions.length,
  ...(outcome.inventory.beforeSnapshotId
    ? { cashBeforeSnapshotId: outcome.inventory.beforeSnapshotId }
    : {}),
  ...(outcome.inventory.afterSnapshotId
    ? { cashAfterSnapshotId: outcome.inventory.afterSnapshotId }
    : {}),
  ...(outcome.trigger ? { depositTrigger: outcome.trigger } : {}),
});
