import {
  DepositOrchestrator,
  type DepositOrchestratorOptions,
  type DepositScopedStatePort,
  createDepositHostFinancialCompletionFinalizer,
  createKioskBaseDepositAuditAdapter,
  createKioskBaseDepositTransactionAdapter,
  registerDepositLocalFinalizers,
} from "@tripley-kit/web-container-deposit-orchestration";
import {
  AuditJournalService,
  SqliteAuditJournalRepository,
  SqliteOperationLedger,
  SqliteOutbox,
  SqliteTransactionMessageRepository,
  SqliteTransactionRepository,
  kioskStandardMigrations,
} from "@tripley-kit/web-container-kiosk-base";
import {
  OperationFinalizationRunner,
  OperationFinalizerRegistry,
  SqliteOperationFinalizationStore,
  TransactionStartupCoordinator,
  type TransactionFinalizationRecoveryPort,
  type TransactionProtectionRecoveryPort,
  operationFinalizationMigration,
} from "@tripley-kit/web-container-kiosk-runtime";
import {
  DefaultMigrationRunner,
  type FrameworkSqliteConnection,
  type Migration,
  SqliteMigrationStore,
} from "@tripley-kit/web-container-storage-core";
import {
  WithdrawalOrchestrator,
  type WithdrawalOrchestratorOptions,
  type WithdrawalScopedStatePort,
  createHostFinancialCompletionFinalizer,
  createKioskBaseWithdrawalAuditAdapter,
  createKioskBaseWithdrawalTransactionAdapter,
  registerWithdrawalLocalFinalizers,
} from "@tripley-kit/web-container-withdrawal-orchestration";

export interface DurableWithdrawalComposition
  extends Omit<WithdrawalOrchestratorOptions, "transactions" | "audit" | "finalization"> {
  readonly scopedState: WithdrawalScopedStatePort;
  readonly hostFinancialCompletion?: boolean | undefined;
}

export interface DurableDepositComposition
  extends Omit<DepositOrchestratorOptions, "transactions" | "audit" | "finalization"> {
  readonly scopedState: DepositScopedStatePort;
  readonly hostFinancialCompletion?: boolean | undefined;
}

export interface DurableKioskTransactionRuntimeOptions {
  readonly db: FrameworkSqliteConnection;
  readonly protection: TransactionProtectionRecoveryPort;
  readonly finalizationRecovery: TransactionFinalizationRecoveryPort;
  readonly migrations?: readonly Migration[] | undefined;
  readonly withdrawal?: DurableWithdrawalComposition | undefined;
  readonly deposit?: DurableDepositComposition | undefined;
}

export interface ReadyTransactionExecutor<TRequest, TResult> {
  execute(request: TRequest): Promise<TResult>;
}

export const createDurableKioskTransactionRuntime = (
  options: DurableKioskTransactionRuntimeOptions,
) => {
  const migrationStore = new SqliteMigrationStore(options.db);
  const migrationRunner = new DefaultMigrationRunner(migrationStore);
  for (const migration of [
    ...kioskStandardMigrations,
    operationFinalizationMigration,
    ...(options.migrations ?? []),
  ]) migrationRunner.register(migration);
  const finalizationStore = new SqliteOperationFinalizationStore(options.db);
  const startup = new TransactionStartupCoordinator({
    db: options.db,
    finalizationRecovery: options.finalizationRecovery,
    finalizations: finalizationStore,
    migrations: {
      runPending: async (db) => {
        await migrationStore.migrate();
        return migrationRunner.runPending(db);
      },
    },
    protection: options.protection,
  });
  const transactions = new SqliteTransactionRepository(options.db);
  const messages = new SqliteTransactionMessageRepository(options.db);
  const audit = new AuditJournalService(new SqliteAuditJournalRepository(options.db));
  const ledger = new SqliteOperationLedger(options.db);
  const outbox = new SqliteOutbox(options.db);

  return {
    audit,
    deposit: options.deposit
      ? gate(startup, createDeposit(options.deposit, transactions, audit, finalizationStore))
      : undefined,
    finalizationStore,
    ledger,
    messages,
    outbox,
    startup,
    transactions,
    withdrawal: options.withdrawal
      ? gate(startup, createWithdrawal(options.withdrawal, transactions, audit, finalizationStore))
      : undefined,
  };
};

const createWithdrawal = (
  options: DurableWithdrawalComposition,
  transactions: SqliteTransactionRepository,
  audit: AuditJournalService,
  store: SqliteOperationFinalizationStore,
): WithdrawalOrchestrator => {
  const transactionPort = createKioskBaseWithdrawalTransactionAdapter(transactions);
  const auditPort = createKioskBaseWithdrawalAuditAdapter(audit);
  const registry = registerWithdrawalLocalFinalizers(new OperationFinalizerRegistry(), {
    audit: auditPort,
    scopedState: options.scopedState,
    transactions: transactionPort,
  });
  if (options.hostFinancialCompletion) registry.register(createHostFinancialCompletionFinalizer(options.host));
  const { hostFinancialCompletion: _completion, scopedState: _scopedState, ...orchestrator } = options;
  return new WithdrawalOrchestrator({
    ...orchestrator,
    audit: auditPort,
    finalization: new OperationFinalizationRunner(registry, store),
    transactions: transactionPort,
  });
};

const createDeposit = (
  options: DurableDepositComposition,
  transactions: SqliteTransactionRepository,
  audit: AuditJournalService,
  store: SqliteOperationFinalizationStore,
): DepositOrchestrator => {
  const transactionPort = createKioskBaseDepositTransactionAdapter(transactions);
  const auditPort = createKioskBaseDepositAuditAdapter(audit);
  const registry = registerDepositLocalFinalizers(new OperationFinalizerRegistry(), {
    audit: auditPort,
    scopedState: options.scopedState,
    transactions: transactionPort,
  });
  if (options.hostFinancialCompletion) {
    registry.register(createDepositHostFinancialCompletionFinalizer(options.host));
  }
  const { hostFinancialCompletion: _completion, scopedState: _scopedState, ...orchestrator } = options;
  return new DepositOrchestrator({
    ...orchestrator,
    audit: auditPort,
    finalization: new OperationFinalizationRunner(registry, store),
    transactions: transactionPort,
  });
};

const gate = <TRequest, TResult>(
  startup: TransactionStartupCoordinator,
  executor: { execute(request: TRequest): Promise<TResult> },
): ReadyTransactionExecutor<TRequest, TResult> => ({
  execute: async (request) => {
    startup.assertReady();
    return executor.execute(request);
  },
});

