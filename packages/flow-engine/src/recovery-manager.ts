import {
  KioskError,
  type DeviceManager,
  type Logger,
  type RecoveryManager,
  type RecoveryOptions,
  type ScreenMap,
  type TransactionResourceRegistry,
  type UiPort,
} from "@tripley-acctron/contracts";

export interface DefaultRecoveryManagerOptions {
  resources: TransactionResourceRegistry;
  logger: Logger;
  devices?: DeviceManager;
  ui?: UiPort<ScreenMap>;
  recoveringScreen?: string;
  clearTransaction?: () => Promise<void>;
}

export class DefaultRecoveryManager implements RecoveryManager {
  public constructor(private readonly options: DefaultRecoveryManagerOptions) {}

  public async recover(options: RecoveryOptions): Promise<void> {
    const failures: unknown[] = [];
    this.options.logger.warn("Recovery started.", {
      reason: options.reason,
      error: options.error,
    });

    await this.showRecovering(options).catch((error: unknown) => {
      failures.push(error);
      this.options.logger.error("Recovery UI update failed.", { reason: options.reason, error });
    });

    await this.cancelDevices().catch((error: unknown) => {
      failures.push(error);
    });

    await this.options.resources.recover(options.reason).catch((error: unknown) => {
      failures.push(error);
    });

    await this.options.clearTransaction?.().catch((error: unknown) => {
      failures.push(error);
      this.options.logger.error("Transaction cleanup failed during recovery.", {
        reason: options.reason,
        error,
      });
    });

    await this.options.resources.clear().catch((error: unknown) => {
      failures.push(error);
      this.options.logger.error("Transaction resource registry clear failed during recovery.", {
        reason: options.reason,
        error,
      });
    });

    if (failures.length > 0) {
      throw new KioskError(
        "recovery.failed",
        `Recovery failed for reason ${options.reason}.`,
        failures,
      );
    }

    this.options.logger.info("Recovery completed.", { reason: options.reason });
  }

  private async showRecovering(options: RecoveryOptions): Promise<void> {
    if (!this.options.ui) {
      return;
    }

    await this.options.ui.show(this.options.recoveringScreen ?? "recovering", {
      reason: options.reason,
    });
  }

  private async cancelDevices(): Promise<void> {
    const failures: unknown[] = [];
    const devices = this.options.devices;
    if (!devices) {
      return;
    }

    const cancellers = [
      ["pinpad", devices.pinpad?.cancel],
      ["barcodeReader", devices.barcodeReader?.cancel],
      ["cardReader", devices.cardReader?.cancel],
      ["cashDispenser", devices.cashDispenser?.cancel],
      ["printer", devices.printer?.cancel],
    ] as const;

    for (const [device, cancel] of cancellers) {
      if (!cancel) {
        continue;
      }

      try {
        await cancel.call(devices[device]);
      } catch (error) {
        failures.push(error);
        this.options.logger.error("Device cancel failed during recovery.", { device, error });
      }
    }

    if (failures.length > 0) {
      throw new KioskError(
        "recovery.failed",
        "Device cancellation failed during recovery.",
        failures,
      );
    }
  }
}
