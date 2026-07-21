import type { Migration } from "@tripley-kit/web-container-storage-core";

import {
  kioskAuditJournalTableSql,
  kioskTransactionMessageTableSql,
  kioskTransactionTableSql,
} from "./repositories";
import { kioskOperationLedgerTableSql, kioskOutboxTableSql } from "./services";

export const kioskBasePackageId = "@tripley-kit/web-container-kiosk-base";

export const kioskStandardMigrations: readonly Migration[] = [
  {
    id: "kiosk-base.001.transaction",
    packageId: kioskBasePackageId,
    up: async (db) => {
      await db.executeBatch(kioskTransactionTableSql);
      await db.executeBatch(kioskTransactionMessageTableSql);
    },
  },
  {
    id: "kiosk-base.002.audit-journal",
    packageId: kioskBasePackageId,
    up: async (db) => {
      await db.executeBatch(kioskAuditJournalTableSql);
    },
  },
  {
    id: "kiosk-base.003.operation-ledger-outbox",
    packageId: kioskBasePackageId,
    up: async (db) => {
      await db.executeBatch(kioskOperationLedgerTableSql);
      await db.executeBatch(kioskOutboxTableSql);
    },
  },
  {
    id: "kiosk-base.004.durable-operation-ledger",
    packageId: kioskBasePackageId,
    up: async (db) => {
      await db.executeBatch(`
        ALTER TABLE kiosk_operation_ledger ADD COLUMN operation_id TEXT;
        ALTER TABLE kiosk_operation_ledger ADD COLUMN entry_method_id TEXT;
        ALTER TABLE kiosk_operation_ledger ADD COLUMN phase TEXT;
        ALTER TABLE kiosk_operation_ledger ADD COLUMN media_custody TEXT;
      `);
    },
  },
];
