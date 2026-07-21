import type {
  CashAcceptanceResult,
  CashAcceptanceSnapshot,
} from "@tripley-kit/web-container-xfs-device-service";

import type {
  DepositHostFacts,
  DepositInventoryFacts,
  DepositInventorySnapshot,
  DepositOutcome,
  DepositPhysicalFacts,
  DepositPolicy,
  DepositPortionFacts,
  DepositReason,
  DepositRequest,
  DepositReturnedMediaResolution,
  DepositStatus,
  DepositTrigger,
} from "./contracts";

export interface DepositOperationState {
  host: DepositHostFacts;
  escrow: {
    batchCount: number;
    revision?: number;
    snapshotHash?: string;
    acceptedNoteCount: number;
    refusedCount: number;
  };
  physical: DepositPhysicalFacts;
  inventory: DepositInventoryFacts;
  portions: DepositPortionFacts[];
}

export const initialDepositState = (policy: DepositPolicy): DepositOperationState => ({
  escrow: { acceptedNoteCount: 0, batchCount: 0, refusedCount: 0 },
  host: {
    protocolId: policy.hostProtocol.id,
    protocolMode: policy.hostProtocol.mode,
    protocolVersion: policy.hostProtocol.version,
    status: "not-requested",
  },
  inventory: { afterCaptureFailed: false },
  physical: { commit: "not-requested", committed: false, reconciliationRequired: false },
  portions: [],
});

export const observeEscrow = (
  state: DepositOperationState,
  snapshot: CashAcceptanceSnapshot,
): number => {
  const previousRefused = state.escrow.refusedCount;
  state.escrow = {
    acceptedNoteCount: snapshot.notes.reduce((sum, note) => sum + note.count, 0),
    batchCount: state.escrow.batchCount + 1,
    refusedCount: snapshot.refusedCount,
    revision: snapshot.revision,
    snapshotHash: snapshot.hash,
  };
  return Math.max(0, snapshot.refusedCount - previousRefused);
};

export const recordRefusedResolution = (
  state: DepositOperationState,
  count: number,
  resolution: DepositReturnedMediaResolution,
): void => {
  state.portions.push({
    custody: resolutionCustody(resolution),
    kind: "refused",
    noteCount: count,
    portionId: `refused-${state.portions.length + 1}`,
    ...(resolution.reasonCode ? { reason: resolution.reasonCode } : {}),
  });
};

export const applyAcceptanceResult = (
  state: DepositOperationState,
  result: CashAcceptanceResult,
): void => {
  state.physical = {
    ...state.physical,
    commit: result.committed ? "completed" : state.physical.commit,
    committed: result.committed,
    reconciliationRequired: result.reason === "recovery-required" || result.portions.some(
      (portion) => portion.custody === "unknown" || portion.custody === "presented",
    ),
    resultReason: result.reason,
  };
  state.portions.push(...result.portions.map((portion) => ({
    custody: portion.custody,
    kind: result.committed ? "accepted" as const : "returned" as const,
    noteCount: portion.notes.reduce((sum, note) => sum + note.count, 0),
    notes: Object.freeze(portion.notes.map((note) => ({ ...note }))),
    portionId: portion.portionId,
    ...(portion.reason ? { reason: portion.reason } : {}),
  })));
};

export const recordInventory = (
  state: DepositOperationState,
  snapshot: DepositInventorySnapshot,
): void => {
  state.inventory = snapshot.boundary === "before"
    ? { ...state.inventory, beforeRevision: snapshot.revision, beforeSnapshotId: snapshot.id }
    : { ...state.inventory, afterRevision: snapshot.revision, afterSnapshotId: snapshot.id };
};

export const recordAfterInventoryFailure = (state: DepositOperationState): void => {
  state.inventory = { ...state.inventory, afterCaptureFailed: true };
  state.physical = { ...state.physical, reconciliationRequired: true };
};

export const buildDepositOutcome = (
  request: DepositRequest,
  policy: DepositPolicy,
  state: DepositOperationState,
  requestedStatus: DepositStatus,
  reason: DepositReason,
  trigger?: DepositTrigger,
): DepositOutcome => {
  const status = safetyStatus(state, requestedStatus);
  return Object.freeze({
    escrow: Object.freeze({ ...state.escrow }),
    host: Object.freeze({ ...state.host }),
    inventory: Object.freeze({ ...state.inventory }),
    kind: "deposit.outcome" as const,
    operationId: request.operationId,
    physical: Object.freeze({ ...state.physical }),
    policyId: policy.id,
    policyVersion: policy.version,
    portions: Object.freeze(state.portions.map((portion) => Object.freeze({ ...portion }))),
    reason,
    safeSummary: Object.freeze({
      acceptedNoteCount: state.escrow.acceptedNoteCount,
      batchCount: state.escrow.batchCount,
      committed: state.physical.committed,
      hostStatus: state.host.status,
      operationId: request.operationId,
      physicalCommit: state.physical.commit,
      policyId: policy.id,
      reason,
      reconciliationRequired: state.physical.reconciliationRequired,
      refusedCount: state.escrow.refusedCount,
      status,
      ...(trigger ? { trigger } : {}),
    }),
    status,
    ...(trigger ? { trigger } : {}),
  });
};

const safetyStatus = (state: DepositOperationState, requested: DepositStatus): DepositStatus => {
  const unsafeCustody = state.portions.some((portion) =>
    ["presented", "unknown", "transport", "escrow"].includes(portion.custody));
  if (unsafeCustody || state.physical.commit === "execution-unknown" ||
      state.physical.reconciliationRequired || state.inventory.afterCaptureFailed) {
    return "intervention";
  }
  return requested;
};

const resolutionCustody = (resolution: DepositReturnedMediaResolution) => {
  if (resolution.status === "taken") return "customer" as const;
  if (resolution.status === "retracted") return "retract-unit" as const;
  return resolution.status;
};
