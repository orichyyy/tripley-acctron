import type { FrameworkSqliteConnection } from "@tripley-kit/web-container-storage-core";
import type { JsonValue } from "@tripley-kit/web-container-types";

import type { Clock } from "./calendar";
import { systemClock } from "./calendar";
import type {
  MediaCustodyStatus,
  OperationLedger,
  OperationLedgerPatch,
  OperationLedgerRecord,
  OperationStartDetails,
  OperationStatus,
} from "./operation-ledger";

interface LedgerRow {
  readonly idempotency_key: string;
  readonly operation_type: string;
  readonly operation_id: string | null;
  readonly entry_method_id: string | null;
  readonly phase: string | null;
  readonly media_custody: MediaCustodyStatus | null;
  readonly status: OperationStatus;
  readonly result_json: string | null;
  readonly error_code: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export class SqliteOperationLedger implements OperationLedger {
  public constructor(
    private readonly db: FrameworkSqliteConnection,
    private readonly clock: Clock = systemClock,
  ) {}

  public async start(
    operationType: string,
    idempotencyKey: string,
    details: OperationStartDetails = {},
  ): Promise<OperationLedgerRecord> {
    const existing = await this.get(idempotencyKey);
    if (existing) return existing;
    const now = this.clock.now().toISOString();
    const record: OperationLedgerRecord = {
      ...details,
      createdAt: now,
      idempotencyKey,
      operationType,
      status: "started",
      updatedAt: now,
    };
    await insertLedger(this.db, record);
    return record;
  }

  public complete(idempotencyKey: string, result?: JsonValue): Promise<OperationLedgerRecord> {
    return this.update(idempotencyKey, { ...(result === undefined ? {} : { result }), status: "completed" });
  }

  public fail(idempotencyKey: string, errorCode: string): Promise<OperationLedgerRecord> {
    return this.update(idempotencyKey, { errorCode, status: "failed" });
  }

  public async update(
    idempotencyKey: string,
    patch: OperationLedgerPatch,
  ): Promise<OperationLedgerRecord> {
    const current = await this.get(idempotencyKey);
    if (!current) throw new Error(`Operation ledger record not found: ${idempotencyKey}`);
    const updated: OperationLedgerRecord = {
      ...current,
      ...(patch.phase === undefined ? {} : { phase: patch.phase }),
      ...(patch.mediaCustody === undefined ? {} : { mediaCustody: patch.mediaCustody }),
      ...(patch.errorCode === undefined ? {} : { errorCode: patch.errorCode }),
      ...(patch.result === undefined ? {} : { result: patch.result }),
      status: patch.status ?? current.status,
      updatedAt: this.clock.now().toISOString(),
    };
    await updateLedger(this.db, updated);
    return updated;
  }

  public async get(idempotencyKey: string): Promise<OperationLedgerRecord | null> {
    const row = await this.db.queryOne<LedgerRow>(
      "SELECT * FROM kiosk_operation_ledger WHERE idempotency_key = ?",
      [idempotencyKey],
    );
    return row ? mapLedger(row) : null;
  }

  public async listActive(): Promise<OperationLedgerRecord[]> {
    const rows = await this.db.queryAll<LedgerRow>(
      `SELECT * FROM kiosk_operation_ledger
       WHERE status IN ('started', 'intervention') ORDER BY created_at`,
    );
    return rows.map(mapLedger);
  }
}

const insertLedger = async (
  db: FrameworkSqliteConnection,
  record: OperationLedgerRecord,
): Promise<void> => {
  await db.run(
    `INSERT INTO kiosk_operation_ledger
     (idempotency_key, operation_type, operation_id, entry_method_id, phase,
      media_custody, status, result_json, error_code, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ledgerParameters(record),
  );
};

const updateLedger = async (
  db: FrameworkSqliteConnection,
  record: OperationLedgerRecord,
): Promise<void> => {
  await db.run(
    `UPDATE kiosk_operation_ledger SET operation_type = ?, operation_id = ?,
     entry_method_id = ?, phase = ?, media_custody = ?, status = ?, result_json = ?,
     error_code = ?, created_at = ?, updated_at = ? WHERE idempotency_key = ?`,
    [...ledgerParameters(record).slice(1), record.idempotencyKey],
  );
};

const ledgerParameters = (record: OperationLedgerRecord) => [
  record.idempotencyKey, record.operationType, record.operationId ?? null,
  record.entryMethodId ?? null, record.phase ?? null, record.mediaCustody ?? null,
  record.status, record.result === undefined ? null : JSON.stringify(record.result),
  record.errorCode ?? null, record.createdAt, record.updatedAt,
] as const;

const mapLedger = (row: LedgerRow): OperationLedgerRecord => ({
  idempotencyKey: row.idempotency_key,
  operationType: row.operation_type,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(row.operation_id === null ? {} : { operationId: row.operation_id }),
  ...(row.entry_method_id === null ? {} : { entryMethodId: row.entry_method_id }),
  ...(row.phase === null ? {} : { phase: row.phase }),
  ...(row.media_custody === null ? {} : { mediaCustody: row.media_custody }),
  ...(row.result_json === null ? {} : { result: JSON.parse(row.result_json) as JsonValue }),
  ...(row.error_code === null ? {} : { errorCode: row.error_code }),
});
