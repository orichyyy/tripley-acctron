import type { TransactionFinalizationRecoveryPort } from "./transaction-startup";
import type { OperationFinalizationRecord } from "./finalization-contracts";
import { OperationFinalizationRunner } from "./finalization-runner";

export class OperationFinalizationRecoveryRegistry
  implements TransactionFinalizationRecoveryPort {
  readonly #runners = new Map<string, OperationFinalizationRunner>();

  public register(runner: OperationFinalizationRunner): this {
    if (this.#runners.has(runner.planVersion)) {
      throw new Error(`Duplicate finalization recovery plan: ${runner.planVersion}`);
    }
    this.#runners.set(runner.planVersion, runner);
    return this;
  }

  public async resume(records: readonly OperationFinalizationRecord[]): Promise<{
    readonly status: "ready" | "intervention";
    readonly reason?: string | undefined;
  }> {
    for (const record of records) {
      const runner = this.#runners.get(record.planVersion);
      if (!runner) {
        return { reason: "finalization.recovery.plan-unavailable", status: "intervention" };
      }
      try {
        await runner.resume(record);
      } catch {
        return { reason: "finalization.recovery.failed", status: "intervention" };
      }
    }
    return { status: "ready" };
  }
}
