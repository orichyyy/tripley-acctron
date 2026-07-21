import type { FrameworkSqlitePort } from "@tripley-kit/web-container-native-adapter";
import {
  createDurableKioskTransactionRuntime,
  type DurableKioskTransactionRuntimeOptions,
} from "@tripley-kit/web-container-kiosk-transaction-runtime";
import { NativePortSqliteConnection } from "@tripley-kit/web-container-storage-sqlite";

export type ExampleDurableTransactionOptions = DurableKioskTransactionRuntimeOptions;

export const createExampleDurableTransactions = async (
  options: ExampleDurableTransactionOptions,
) => {
  const runtime = createDurableKioskTransactionRuntime(options);
  const readiness = await runtime.startup.initialize();
  return {
    ...runtime,
    connection: options.db,
    readiness,
    dispose: () => options.db.close(),
  };
};

export const createExampleNativeDurableTransactions = async (
  sqlite: FrameworkSqlitePort,
  options: Omit<ExampleDurableTransactionOptions, "db">,
) => createExampleDurableTransactions({
  ...options,
  db: new NativePortSqliteConnection(sqlite),
});
