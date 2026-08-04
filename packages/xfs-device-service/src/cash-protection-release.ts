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

  try {
    await input.recoveryLeases.close(input.resources.recoveryLease, input.outcome);
    recoveryPersisted = true;
  } catch {
    reconciliationRequired = true;
  }

  try {
    await input.commandLeases.release(input.resources.hostCommandLease);
    hostReleased = true;
  } catch {
    reconciliationRequired = true;
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
          hostEpoch: input.resources.hostCommandLease.hostEpoch,
          operationId: input.resources.hostCommandLease.operationId,
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
