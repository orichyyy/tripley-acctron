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
  OperationFinalizationRecoveryRegistry,
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

import { createKioskOutcomeRecoveryProjector } from "./recovery-context";

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
  readonly finalizationRecovery?: TransactionFinalizationRecoveryPort | undefined;
  readonly configureFinalizationRecovery?:
    | ((context: DurableFinalizationRecoveryConfiguration) => void)
    | undefined;
  readonly migrations?: readonly Migration[] | undefined;
  readonly withdrawal?: DurableWithdrawalComposition | undefined;
  readonly deposit?: DurableDepositComposition | undefined;
}

export interface DurableFinalizationRecoveryConfiguration {
  readonly registry: OperationFinalizationRecoveryRegistry;
  readonly store: SqliteOperationFinalizationStore;
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
  const recoveryRegistry = new OperationFinalizationRecoveryRegistry();
  const transactions = new SqliteTransactionRepository(options.db);
  const messages = new SqliteTransactionMessageRepository(options.db);
  const audit = new AuditJournalService(new SqliteAuditJournalRepository(options.db));
  const ledger = new SqliteOperationLedger(options.db);
  const outbox = new SqliteOutbox(options.db);
  const withdrawal = options.withdrawal
    ? createWithdrawal(options.withdrawal, transactions, audit, finalizationStore)
    : undefined;
  const deposit = options.deposit
    ? createDeposit(options.deposit, transactions, audit, finalizationStore)
    : undefined;
  if (withdrawal) recoveryRegistry.register(withdrawal.finalization);
  if (deposit) recoveryRegistry.register(deposit.finalization);
  options.configureFinalizationRecovery?.({ registry: recoveryRegistry, store: finalizationStore });
  const startup = new TransactionStartupCoordinator({
    db: options.db,
    finalizationRecovery: options.finalizationRecovery ?? recoveryRegistry,
    finalizations: finalizationStore,
    migrations: {
      runPending: async (db) => {
        await migrationStore.migrate();
        return migrationRunner.runPending(db);
      },
    },
    protection: options.protection,
  });

  return {
    audit,
    deposit: deposit ? gate(startup, deposit.orchestrator) : undefined,
    finalizationRecovery: recoveryRegistry,
    finalizationStore,
    ledger,
    messages,
    outbox,
    startup,
    transactions,
    withdrawal: withdrawal ? gate(startup, withdrawal.orchestrator) : undefined,
  };
};

interface OrchestratorComposition<T> {
  readonly finalization: OperationFinalizationRunner;
  readonly orchestrator: T;
}

const createWithdrawal = (
  options: DurableWithdrawalComposition,
  transactions: SqliteTransactionRepository,
  audit: AuditJournalService,
  store: SqliteOperationFinalizationStore,
): OrchestratorComposition<WithdrawalOrchestrator> => {
  const transactionPort = createKioskBaseWithdrawalTransactionAdapter(transactions);
  const auditPort = createKioskBaseWithdrawalAuditAdapter(audit);
  const registry = registerWithdrawalLocalFinalizers(new OperationFinalizerRegistry(), {
    audit: auditPort,
    scopedState: options.scopedState,
    transactions: transactionPort,
  });
  if (options.hostFinancialCompletion) registry.register(createHostFinancialCompletionFinalizer(options.host));
  const { hostFinancialCompletion: _completion, scopedState: _scopedState, ...orchestrator } = options;
  const finalization = new OperationFinalizationRunner(
    registry,
    store,
    () => new Date(),
    createKioskOutcomeRecoveryProjector("withdrawal.outcome"),
  );
  return { finalization, orchestrator: new WithdrawalOrchestrator({
    ...orchestrator,
    audit: auditPort,
    finalization,
    transactions: transactionPort,
  }) };
};

const createDeposit = (
  options: DurableDepositComposition,
  transactions: SqliteTransactionRepository,
  audit: AuditJournalService,
  store: SqliteOperationFinalizationStore,
): OrchestratorComposition<DepositOrchestrator> => {
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
  const finalization = new OperationFinalizationRunner(
    registry,
    store,
    () => new Date(),
    createKioskOutcomeRecoveryProjector("deposit.outcome"),
  );
  return { finalization, orchestrator: new DepositOrchestrator({
    ...orchestrator,
    audit: auditPort,
    finalization,
    transactions: transactionPort,
  }) };
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
