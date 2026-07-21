import type { FrameworkSqliteConnection } from "@tripley-kit/web-container-storage-core";
import type { JsonValue } from "@tripley-kit/web-container-types";

import type { AuditJournalRecord, AuditJournalRepository } from "./audit";
import { jsonText, optional, parseJson } from "./sqlite-codec";

interface AuditRow {
  readonly id: string;
  readonly event_id: string;
  readonly event_name: string | null;
  readonly business_type: string | null;
  readonly transaction_id: string | null;
  readonly session_id: string | null;
  readonly flow_instance_id: string | null;
  readonly trace_id: string | null;
  readonly message: string;
  readonly data_json: string | null;
  readonly created_at: string;
}

export class SqliteAuditJournalRepository implements AuditJournalRepository {
  public constructor(private readonly db: FrameworkSqliteConnection) {}

  public async append(record: AuditJournalRecord): Promise<void> {
    await this.db.run(
      `INSERT INTO kiosk_audit_journal
       (id, event_id, event_name, business_type, transaction_id, session_id,
        flow_instance_id, trace_id, message, data_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [record.id, record.eventId, record.eventName ?? null, record.businessType ?? null,
        record.transactionId ?? null, record.sessionId ?? null, record.flowInstanceId ?? null,
        record.traceId ?? null, record.message, jsonText(record.data), record.createdAt],
    );
  }

  public async listByTransaction(transactionId: string): Promise<AuditJournalRecord[]> {
    const rows = await this.db.queryAll<AuditRow>(
      `SELECT * FROM kiosk_audit_journal
       WHERE transaction_id = ? ORDER BY created_at, id`,
      [transactionId],
    );
    return rows.map(mapAudit);
  }
}

const mapAudit = (row: AuditRow): AuditJournalRecord => ({
  id: row.id,
  eventId: row.event_id,
  message: row.message,
  createdAt: row.created_at,
  ...optional("eventName", row.event_name),
  ...optional("businessType", row.business_type),
  ...optional("transactionId", row.transaction_id),
  ...optional("sessionId", row.session_id),
  ...optional("flowInstanceId", row.flow_instance_id),
  ...optional("traceId", row.trace_id),
  ...(parseJson<JsonValue>(row.data_json) === undefined
    ? {}
    : { data: parseJson<JsonValue>(row.data_json)! }),
});

