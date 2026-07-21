import type {
  FrameworkSqliteConnection,
  Migration,
} from "@tripley-kit/web-container-storage-core";

import type { OperationFinalizationRecord, OperationFinalizationStore } from "./finalization-contracts";

export const OPERATION_FINALIZATION_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS kiosk_operation_finalization (
  operation_id TEXT PRIMARY KEY,
  plan_version TEXT NOT NULL,
  status TEXT NOT NULL,
  record_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_kiosk_operation_finalization_incomplete
ON kiosk_operation_finalization(status, updated_at)
WHERE status <> 'completed';`;

export const operationFinalizationMigration: Migration = {
  id: "001-operation-finalization",
  packageId: "@tripley-kit/web-container-kiosk-runtime",
  up: async (db) => db.executeBatch(OPERATION_FINALIZATION_MIGRATION_SQL),
};

interface FinalizationRow {
  readonly operation_id: string;
  readonly record_json: string;
}

export class SqliteOperationFinalizationStore implements OperationFinalizationStore {
  public constructor(private readonly db: FrameworkSqliteConnection) {}

  public async migrate(): Promise<void> {
    await this.db.executeBatch(OPERATION_FINALIZATION_MIGRATION_SQL);
  }

  public async load(operationId: string): Promise<OperationFinalizationRecord | undefined> {
    const row = await this.db.queryOne<FinalizationRow>(
      "SELECT operation_id, record_json FROM kiosk_operation_finalization WHERE operation_id = ?",
      [operationId],
    );
    return row ? decodeRecord(row) : undefined;
  }

  public async save(record: OperationFinalizationRecord): Promise<void> {
    await this.db.run(
      `INSERT INTO kiosk_operation_finalization
       (operation_id, plan_version, status, record_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(operation_id) DO UPDATE SET
         plan_version = excluded.plan_version,
         status = excluded.status,
         record_json = excluded.record_json,
         updated_at = excluded.updated_at`,
      [
        record.operationId,
        record.planVersion,
        record.status,
        JSON.stringify(record),
        record.updatedAt,
      ],
    );
  }

  public async listIncomplete(): Promise<readonly OperationFinalizationRecord[]> {
    const rows = await this.db.queryAll<FinalizationRow>(
      `SELECT operation_id, record_json
       FROM kiosk_operation_finalization
       WHERE status <> 'completed'
       ORDER BY updated_at, operation_id`,
    );
    return rows.map(decodeRecord);
  }
}

const decodeRecord = (row: FinalizationRow): OperationFinalizationRecord => {
  const value: unknown = JSON.parse(row.record_json);
  if (!isFinalizationRecord(value) || value.operationId !== row.operation_id) {
    throw new Error(`Invalid operation finalization record for '${row.operation_id}'.`);
  }
  return value;
};

const isFinalizationRecord = (value: unknown): value is OperationFinalizationRecord => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<OperationFinalizationRecord>;
  return (
    typeof record.operationId === "string" &&
    typeof record.planVersion === "string" &&
    typeof record.status === "string" &&
    Array.isArray(record.steps) &&
    typeof record.updatedAt === "string"
  );
};
