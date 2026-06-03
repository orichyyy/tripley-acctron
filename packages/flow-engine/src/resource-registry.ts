import {
  KioskError,
  type Logger,
  type RecoveryReason,
  type TransactionResource,
  type TransactionResourceRegistry,
} from "@tripley-acctron/contracts";

interface RegisteredResource {
  name: string;
  resource: TransactionResource;
  active: boolean;
}

export class InMemoryTransactionResourceRegistry implements TransactionResourceRegistry {
  private readonly resources: RegisteredResource[] = [];

  public constructor(private readonly logger: Logger) {}

  public register(name: string, resource: TransactionResource) {
    const entry: RegisteredResource = { name, resource, active: true };
    this.resources.push(entry);
    return {
      dispose: () => {
        entry.active = false;
      },
    };
  }

  public async recover(reason: RecoveryReason): Promise<void> {
    const failures: unknown[] = [];
    const activeResources = this.resources.filter((entry) => entry.active).reverse();

    for (const entry of activeResources) {
      const handler = selectRecoveryHandler(entry.resource, reason);
      if (!handler) {
        continue;
      }

      try {
        await handler();
      } catch (error) {
        failures.push(error);
        this.logger.error("Transaction resource recovery failed.", {
          resource: entry.name,
          reason,
          error,
        });
      }
    }

    if (failures.length > 0) {
      throw new KioskError(
        "recovery.failed",
        `Transaction recovery failed for ${failures.length} resource(s).`,
        failures,
      );
    }
  }

  public async clear(): Promise<void> {
    this.resources.length = 0;
  }
}

function selectRecoveryHandler(
  resource: TransactionResource,
  reason: RecoveryReason,
): (() => Promise<void>) | undefined {
  switch (reason) {
    case "normalEnd":
      return resource.onNormalEnd;
    case "cancel":
      return resource.onCancel;
    case "timeout":
      return resource.onTimeout;
    case "unhandledError":
      return resource.onError;
    case "deviceFailure":
      return resource.onDeviceFailure;
  }
}
