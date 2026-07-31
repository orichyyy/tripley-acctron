import { FrameworkError } from "@tripley-kit/web-container-errors";

import type {
  CashRecoveryTransferPort,
  CashRecoveryTransferReceipt,
} from "./cash-contracts";
import type { CashRecoveryRunResult } from "./recovery-contracts";

export interface CashRecoverySupervisorPort extends CashRecoveryTransferPort {
  recover(): Promise<CashRecoveryRunResult>;
}

export class CashRecoveryWorker implements CashRecoveryTransferPort {
  private accepting = true;
  private failure: unknown;
  private lastResult: CashRecoveryRunResult | undefined;
  private tail: Promise<void> = Promise.resolve();

  public constructor(private readonly supervisor: CashRecoverySupervisorPort) {}

  public async acceptTransfer(
    input: Parameters<CashRecoveryTransferPort["acceptTransfer"]>[0],
  ): Promise<CashRecoveryTransferReceipt> {
    if (!this.accepting) {
      throw workerError(
        "cash.recoveryWorker.stopping",
        "Cash recovery worker is stopping and cannot accept ownership.",
      );
    }
    const receipt = await this.supervisor.acceptTransfer(input);
    this.schedule();
    return receipt;
  }

  public recoverNow(): Promise<CashRecoveryRunResult> {
    const run = this.tail
      .catch(() => undefined)
      .then(() => this.supervisor.recover());
    this.tail = run.then(
      (result) => {
        this.lastResult = result;
      },
      (error) => {
        this.failure = error;
      },
    );
    return run;
  }

  public async dispose(): Promise<void> {
    this.accepting = false;
    await this.tail;
    if (this.failure) throw this.failure;
    if (this.lastResult && this.lastResult.status !== "ready") {
      throw workerError(
        "cash.recoveryWorker.unresolved",
        "Runtime shutdown is blocked by unresolved cash recovery.",
      );
    }
  }

  private schedule(): void {
    void this.recoverNow().catch(() => undefined);
  }
}

const workerError = (code: string, message: string): FrameworkError =>
  new FrameworkError({
    category: "dependency",
    code,
    message,
  });
