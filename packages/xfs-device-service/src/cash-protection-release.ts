import type {
  CashCustodyOutcome,
  CashRecoveryLeasePort,
  HeldCashSessionResources,
} from "./cash-contracts";
import type { XfsCommandLeaseClientLike } from "./types";

export interface CashProtectionReleaseInput {
  readonly commandLeases: XfsCommandLeaseClientLike;
  readonly outcome: CashCustodyOutcome;
  readonly recoveryLeases: CashRecoveryLeasePort;
  readonly resourceGroup: string;
  readonly resources: HeldCashSessionResources;
  readonly ttlMs: number;
}

export interface CashProtectionReleaseResult {
  readonly reconciliationRequired: boolean;
}

const expectedCustodyOutcome: Partial<Record<CashCustodyOutcome, string>> = {
  notDispensed: "notMoved",
  retracted: "retracted",
  taken: "taken",
};

export const releaseCashProtection = async (
  input: CashProtectionReleaseInput,
): Promise<CashProtectionReleaseResult> => {
  let reconciliationRequired = false;
  let recoveryPersisted = false;
  let hostReleased = false;
  let hostLease = input.resources.hostCommandLease;

  try {
    await input.recoveryLeases.close(input.resources.recoveryLease, input.outcome);
    recoveryPersisted = true;
  } catch {
    reconciliationRequired = true;
  }

  if (recoveryPersisted) {
    try {
      hostLease = await input.commandLeases.transition({
        fencingToken: hostLease.fencingToken,
        fromAuthority: "transaction",
        hostEpoch: hostLease.hostEpoch,
        logicalService: hostLease.logicalService,
        nextFencingToken: hostLease.fencingToken + 1,
        operationId: hostLease.operationId,
        toAuthority: "recovery",
        ttlMs: input.ttlMs,
      });
      await input.commandLeases.release(hostLease);
      hostReleased = true;
    } catch {
      reconciliationRequired = true;
    }
  }

  const expected = expectedCustodyOutcome[input.outcome];
  if (recoveryPersisted && hostReleased && expected) {
    try {
      const status = await input.commandLeases.protectionStatus?.(input.resourceGroup);
      if (status?.state === "idle") {
        // No protected custody was established for this operation.
      } else if (
        status?.state === "terminal" &&
        status.operationId === input.resources.hostCommandLease.operationId &&
        status.custodyOutcome === expected &&
        input.commandLeases.acknowledgeProtection
      ) {
        await input.commandLeases.acknowledgeProtection({
          hostEpoch: hostLease.hostEpoch,
          operationId: hostLease.operationId,
          resourceGroup: input.resourceGroup,
        });
      } else {
        reconciliationRequired = true;
      }
    } catch {
      reconciliationRequired = true;
    }
  } else if (input.outcome !== "custodyUnknown") {
    reconciliationRequired = true;
  }

  try {
    await input.resources.deviceLease.release();
  } catch {
    reconciliationRequired = true;
  }

  return { reconciliationRequired };
};
