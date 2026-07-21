import type {
  FrameworkSqliteConnection,
  FrameworkSqliteTransaction,
} from "@tripley-kit/web-container-storage-core";
import type { Metadata } from "@tripley-kit/web-container-types";

import type { Clock } from "../services/calendar";
import { systemClock } from "../services/calendar";
import { jsonText, optional, parseJson } from "./sqlite-codec";
import type {
  AppendTransactionMessageInput,
  CreateTransactionInput,
  TransactionMessageRecord,
  TransactionRecord,
  TransactionRepository,
  TransactionStatus,
  TransactionStatusPatch,
} from "./transactions";

export interface TransactionMessageRepository {
  append(
    transactionId: string,
    message: AppendTransactionMessageInput,
  ): Promise<TransactionMessageRecord>;
  list(transactionId: string): Promise<TransactionMessageRecord[]>;
}

export class SqliteTransactionMessageRepository implements TransactionMessageRepository {
  public constructor(
    private readonly db: FrameworkSqliteConnection,
    private readonly clock: Clock = systemClock,
  ) {}

  public async append(
    transactionId: string,
    message: AppendTransactionMessageInput,
  ): Promise<TransactionMessageRecord> {
    return this.db.transaction(async (tx) => {
      await assertTransactionExists(tx, transactionId);
      const sequence = await nextMessageSequence(tx, transactionId);
      const record = { ...message, createdAt: this.clock.now().toISOString(), seq: sequence, transactionId };
      await insertMessage(tx, record);
      return record;
    });
  }

  public async list(transactionId: string): Promise<TransactionMessageRecord[]> {
    const rows = await this.db.queryAll<TransactionMessageRow>(
      `SELECT * FROM kiosk_transaction_message
       WHERE transaction_id = ? ORDER BY seq`,
      [transactionId],
    );
    return rows.map(mapMessage);
  }
}

export class SqliteTransactionRepository implements TransactionRepository {
  private readonly messages: TransactionMessageRepository;

  public constructor(
    private readonly db: FrameworkSqliteConnection,
    private readonly clock: Clock = systemClock,
    messages?: TransactionMessageRepository,
  ) {
    this.messages = messages ?? new SqliteTransactionMessageRepository(db, clock);
  }

  public async create(input: CreateTransactionInput): Promise<TransactionRecord> {
    const record: TransactionRecord = {
      ...input,
      startedAt: this.clock.now().toISOString(),
      status: "started",
    };
    await this.db.run(
      `INSERT INTO kiosk_transaction
       (id, business_type, status, amount, currency, session_id, flow_instance_id,
        trace_id, correlation_id, started_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id, record.businessType, record.status, record.amount ?? null,
        record.currency ?? null, record.sessionId ?? null, record.flowInstanceId ?? null,
        record.traceId ?? null, record.correlationId ?? null, record.startedAt,
        jsonText(record.metadata),
      ],
    );
    return record;
  }

  public appendMessage(
    transactionId: string,
    message: AppendTransactionMessageInput,
  ): Promise<TransactionMessageRecord> {
    return this.messages.append(transactionId, message);
  }

  public async updateStatus(
    transactionId: string,
    status: TransactionStatus,
    patch: TransactionStatusPatch = {},
  ): Promise<void> {
    const result = await this.db.run(
      `UPDATE kiosk_transaction SET status = ?,
       completed_at = COALESCE(?, completed_at), failed_at = COALESCE(?, failed_at),
       result_code = COALESCE(?, result_code), result_message = COALESCE(?, result_message),
       metadata_json = COALESCE(?, metadata_json) WHERE id = ?`,
      [status, patch.completedAt ?? null, patch.failedAt ?? null, patch.resultCode ?? null,
        patch.resultMessage ?? null, jsonText(patch.metadata), transactionId],
    );
    if (result.changes === 0) throw new Error(`Transaction not found: ${transactionId}`);
  }

  public async get(transactionId: string): Promise<TransactionRecord | null> {
    const row = await this.db.queryOne<TransactionRow>(
      "SELECT * FROM kiosk_transaction WHERE id = ?",
      [transactionId],
    );
    return row ? mapTransaction(row) : null;
  }

  public listMessages(transactionId: string): Promise<TransactionMessageRecord[]> {
    return this.messages.list(transactionId);
  }
}

interface TransactionRow {
  readonly id: string;
  readonly business_type: string;
  readonly status: TransactionStatus;
  readonly amount: number | null;
  readonly currency: string | null;
  readonly session_id: string | null;
  readonly flow_instance_id: string | null;
  readonly trace_id: string | null;
  readonly correlation_id: string | null;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly failed_at: string | null;
  readonly result_code: string | null;
  readonly result_message: string | null;
  readonly metadata_json: string | null;
}

interface TransactionMessageRow {
  readonly id: string;
  readonly transaction_id: string;
  readonly seq: number;
  readonly direction: TransactionMessageRecord["direction"];
  readonly message_type: string;
  readonly channel: string | null;
  readonly status: string | null;
  readonly request_id: string | null;
  readonly trace_id: string | null;
  readonly correlation_id: string | null;
  readonly payload_json: string | null;
  readonly payload_hash: string | null;
  readonly created_at: string;
}

const assertTransactionExists = async (
  tx: FrameworkSqliteTransaction,
  transactionId: string,
): Promise<void> => {
  const row = await tx.queryOne<{ readonly id: string }>(
    "SELECT id FROM kiosk_transaction WHERE id = ?",
    [transactionId],
  );
  if (!row) throw new Error(`Transaction not found: ${transactionId}`);
};

const nextMessageSequence = async (
  tx: FrameworkSqliteTransaction,
  transactionId: string,
): Promise<number> => {
  const row = await tx.queryOne<{ readonly next_seq: number }>(
    "SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM kiosk_transaction_message WHERE transaction_id = ?",
    [transactionId],
  );
  return row?.next_seq ?? 1;
};

const insertMessage = async (
  tx: FrameworkSqliteTransaction,
  record: TransactionMessageRecord,
): Promise<void> => {
  await tx.run(
    `INSERT INTO kiosk_transaction_message
     (id, transaction_id, seq, direction, message_type, channel, status, request_id,
      trace_id, correlation_id, payload_json, payload_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [record.id, record.transactionId, record.seq, record.direction, record.messageType,
      record.channel ?? null, record.status ?? null, record.requestId ?? null,
      record.traceId ?? null, record.correlationId ?? null, jsonText(record.payload),
      record.payloadHash ?? null, record.createdAt],
  );
};

const mapTransaction = (row: TransactionRow): TransactionRecord => ({
  id: row.id,
  businessType: row.business_type,
  status: row.status,
  startedAt: row.started_at,
  ...optional("amount", row.amount),
  ...optional("currency", row.currency),
  ...optional("sessionId", row.session_id),
  ...optional("flowInstanceId", row.flow_instance_id),
  ...optional("traceId", row.trace_id),
  ...optional("correlationId", row.correlation_id),
  ...optional("completedAt", row.completed_at),
  ...optional("failedAt", row.failed_at),
  ...optional("resultCode", row.result_code),
  ...optional("resultMessage", row.result_message),
  ...(parseJson<Metadata>(row.metadata_json) === undefined
    ? {}
    : { metadata: parseJson<Metadata>(row.metadata_json)! }),
});

const mapMessage = (row: TransactionMessageRow): TransactionMessageRecord => ({
  id: row.id,
  transactionId: row.transaction_id,
  seq: row.seq,
  direction: row.direction,
  messageType: row.message_type,
  createdAt: row.created_at,
  ...optional("channel", row.channel),
  ...optional("status", row.status),
  ...optional("requestId", row.request_id),
  ...optional("traceId", row.trace_id),
  ...optional("correlationId", row.correlation_id),
  ...(parseJson<TransactionMessageRecord["payload"]>(row.payload_json) === undefined
    ? {}
    : { payload: parseJson<TransactionMessageRecord["payload"]>(row.payload_json)! }),
  ...optional("payloadHash", row.payload_hash),
});

