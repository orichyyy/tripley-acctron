import type {
  AppliedMigration,
  FrameworkSqliteConnection,
} from "@tripley-kit/web-container-storage-core";

import type { OperationFinalizationRecord, OperationFinalizationStore } from "./finalization-contracts";

export type TransactionStartupStatus =
  | "idle"
  | "migrating"
  | "recovering"
  | "finalizing"
  | "ready"
  | "intervention"
  | "failed";

export interface TransactionStartupSnapshot {
  readonly status: TransactionStartupStatus;
  readonly appliedMigrationIds: readonly string[];
  readonly incompleteFinalizationCount: number;
  readonly reason?: string | undefined;
}

export interface TransactionMigrationPort {
  runPending(db: FrameworkSqliteConnection): Promise<readonly AppliedMigration[]>;
}

export interface TransactionProtectionRecoveryPort {
  recover(): Promise<{
    readonly status: "ready" | "recovering" | "intervention";
    readonly safeSummary: Readonly<Record<string, string | number | boolean>>;
  }>;
}

export interface TransactionFinalizationRecoveryPort {
  resume(records: readonly OperationFinalizationRecord[]): Promise<{
    readonly status: "ready" | "intervention";
    readonly reason?: string | undefined;
  }>;
}

export interface TransactionStartupCoordinatorOptions {
  readonly db: FrameworkSqliteConnection;
  readonly migrations: TransactionMigrationPort;
  readonly protection: TransactionProtectionRecoveryPort;
  readonly finalizations: OperationFinalizationStore;
  readonly finalizationRecovery: TransactionFinalizationRecoveryPort;
}

export class TransactionStartupCoordinator {
  private current: TransactionStartupSnapshot = snapshot("idle");
  private initialization?: Promise<TransactionStartupSnapshot>;
  private readonly listeners = new Set<(value: TransactionStartupSnapshot) => void>();

  public constructor(private readonly options: TransactionStartupCoordinatorOptions) {}

  public initialize(): Promise<TransactionStartupSnapshot> {
    this.initialization ??= this.run();
    return this.initialization;
  }

  public snapshot(): TransactionStartupSnapshot {
    return this.current;
  }

  public subscribe(listener: (value: TransactionStartupSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  public canExecute(): boolean {
    return this.current.status === "ready";
  }

  public assertReady(): void {
    if (!this.canExecute()) {
      throw new Error(`Transaction runtime is not ready: ${this.current.status}.`);
    }
  }

  private async run(): Promise<TransactionStartupSnapshot> {
    try {
      this.set(snapshot("migrating"));
      const applied = await this.options.migrations.runPending(this.options.db);
      this.set({ ...snapshot("recovering"), appliedMigrationIds: applied.map((item) => item.id) });
      const recovery = await this.options.protection.recover();
      if (recovery.status !== "ready") {
        return this.set({
          ...this.current,
          reason: `protection.${recovery.status}`,
          status: "intervention",
        });
      }
      const records = await this.options.finalizations.listIncomplete();
      this.set({ ...this.current, incompleteFinalizationCount: records.length, status: "finalizing" });
      const finalization = await this.options.finalizationRecovery.resume(records);
      if (finalization.status !== "ready") {
        return this.set({
          ...this.current,
          reason: finalization.reason ?? "finalization.intervention",
          status: "intervention",
        });
      }
      return this.set({ ...this.current, status: "ready" });
    } catch (error) {
      this.set({ ...this.current, reason: safeError(error), status: "failed" });
      throw error;
    }
  }

  private set(value: TransactionStartupSnapshot): TransactionStartupSnapshot {
    this.current = value;
    for (const listener of this.listeners) listener(value);
    return value;
  }
}

const snapshot = (status: TransactionStartupStatus): TransactionStartupSnapshot => ({
  appliedMigrationIds: [],
  incompleteFinalizationCount: 0,
  status,
});

const safeError = (error: unknown): string =>
  error instanceof Error ? error.message : "transaction-startup.failed";

