import type { CashAcceptanceRecord, CashAcceptanceStore, CimCashInClient } from "./cash-acceptance-contracts";

export type CashAcceptanceRecoveryDecision =
  | { readonly action: "observe"; readonly reason: "physical-commit-dispatched" }
  | { readonly action: "rollback"; readonly reason: "escrow-not-committed" }
  | { readonly action: "intervention"; readonly reason: "unknown-device-state" };

export interface CashAcceptanceRecoveryObservation {
  readonly operation: CashAcceptanceRecord;
  readonly deviceStatus: string;
  readonly decision: CashAcceptanceRecoveryDecision;
}

export class CashAcceptanceRecoverySupervisor {
  constructor(private readonly store: CashAcceptanceStore, private readonly client: CimCashInClient) {}

  async inspect(): Promise<readonly CashAcceptanceRecoveryObservation[]> {
    const records = await this.store.listUnresolved();
    return Promise.all(records.map(async (operation) => {
      const status = await this.client.getCashInStatus();
      return { operation, deviceStatus: status.status, decision: decide(operation, status.status) };
    }));
  }

  async executeRollback(observation: CashAcceptanceRecoveryObservation, timeoutMs: number): Promise<void> {
    if (observation.decision.action !== "rollback") {
      throw new Error(`Recovery action is ${observation.decision.action}, not rollback`);
    }
    await this.client.cashInRollback({ timeoutMs });
  }
}

function decide(operation: CashAcceptanceRecord, deviceStatus: string): CashAcceptanceRecoveryDecision {
  if (operation.physicalCommitDispatched) {
    return { action: "observe", reason: "physical-commit-dispatched" };
  }
  if (["active", "escrow", "cash-in-active"].includes(deviceStatus)) {
    return { action: "rollback", reason: "escrow-not-committed" };
  }
  return { action: "intervention", reason: "unknown-device-state" };
}
