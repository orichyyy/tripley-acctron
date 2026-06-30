import type { JsonValue, Metadata } from "@tripley/web-container-types";

export type TransactionStatus = "started" | "authorized" | "completed" | "failed" | "cancelled";

export interface TransactionRecord {
  readonly id: string;
  readonly businessType: string;
  readonly status: TransactionStatus;
  readonly amount?: number;
  readonly currency?: string;
  readonly sessionId?: string;
  readonly flowInstanceId?: string;
  readonly traceId?: string;
  readonly correlationId?: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly failedAt?: string;
  readonly resultCode?: string;
  readonly resultMessage?: string;
  readonly metadata?: Metadata;
}

export interface CreateTransactionInput {
  readonly id: string;
  readonly businessType: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly sessionId?: string;
  readonly flowInstanceId?: string;
  readonly traceId?: string;
  readonly correlationId?: string;
  readonly metadata?: Metadata;
}

export type TransactionMessageDirection = "inbound" | "outbound";

export interface TransactionMessageRecord {
  readonly id: string;
  readonly transactionId: string;
  readonly seq: number;
  readonly direction: TransactionMessageDirection;
  readonly messageType: string;
  readonly channel?: string;
  readonly status?: string;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly correlationId?: string;
  readonly payload?: JsonValue;
  readonly payloadHash?: string;
  readonly createdAt: string;
}

export interface AppendTransactionMessageInput {
  readonly id: string;
  readonly direction: TransactionMessageDirection;
  readonly messageType: string;
  readonly channel?: string;
  readonly status?: string;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly correlationId?: string;
  readonly payload?: JsonValue;
  readonly payloadHash?: string;
}

export interface TransactionStatusPatch {
  readonly completedAt?: string;
  readonly failedAt?: string;
  readonly resultCode?: string;
  readonly resultMessage?: string;
  readonly metadata?: Metadata;
}

export interface TransactionRepository {
  create(input: CreateTransactionInput): Promise<TransactionRecord>;
  appendMessage(
    transactionId: string,
    message: AppendTransactionMessageInput,
  ): Promise<TransactionMessageRecord>;
  updateStatus(
    transactionId: string,
    status: TransactionStatus,
    patch?: TransactionStatusPatch,
  ): Promise<void>;
  get(transactionId: string): Promise<TransactionRecord | null>;
  listMessages(transactionId: string): Promise<TransactionMessageRecord[]>;
}

export interface AuditJournalRecord {
  readonly id: string;
  readonly eventId: string;
  readonly eventName?: string;
  readonly businessType?: string;
  readonly transactionId?: string;
  readonly sessionId?: string;
  readonly flowInstanceId?: string;
  readonly traceId?: string;
  readonly message: string;
  readonly data?: JsonValue;
  readonly createdAt: string;
}

export interface AuditJournalRepository {
  append(record: AuditJournalRecord): Promise<void>;
  listByTransaction(transactionId: string): Promise<AuditJournalRecord[]>;
}

export class InMemoryTransactionRepository implements TransactionRepository {
  private readonly transactions = new Map<string, TransactionRecord>();
  private readonly messages = new Map<string, TransactionMessageRecord[]>();

  public async create(input: CreateTransactionInput): Promise<TransactionRecord> {
    const record = {
      businessType: input.businessType,
      id: input.id,
      startedAt: new Date().toISOString(),
      status: "started",
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.flowInstanceId !== undefined ? { flowInstanceId: input.flowInstanceId } : {}),
      ...(input.traceId !== undefined ? { traceId: input.traceId } : {}),
      ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    } satisfies TransactionRecord;
    this.transactions.set(record.id, record);
    this.messages.set(record.id, []);
    return record;
  }

  public async appendMessage(
    transactionId: string,
    message: AppendTransactionMessageInput,
  ): Promise<TransactionMessageRecord> {
    const messages = this.messages.get(transactionId);
    if (!messages) {
      throw new Error(`Transaction is missing: ${transactionId}`);
    }

    const record = {
      id: message.id,
      transactionId,
      seq: messages.length + 1,
      direction: message.direction,
      messageType: message.messageType,
      createdAt: new Date().toISOString(),
      ...(message.channel !== undefined ? { channel: message.channel } : {}),
      ...(message.status !== undefined ? { status: message.status } : {}),
      ...(message.requestId !== undefined ? { requestId: message.requestId } : {}),
      ...(message.traceId !== undefined ? { traceId: message.traceId } : {}),
      ...(message.correlationId !== undefined ? { correlationId: message.correlationId } : {}),
      ...(message.payload !== undefined ? { payload: message.payload } : {}),
      ...(message.payloadHash !== undefined ? { payloadHash: message.payloadHash } : {}),
    } satisfies TransactionMessageRecord;
    messages.push(record);
    return record;
  }

  public async updateStatus(
    transactionId: string,
    status: TransactionStatus,
    patch: TransactionStatusPatch = {},
  ): Promise<void> {
    const existing = this.transactions.get(transactionId);
    if (!existing) {
      throw new Error(`Transaction is missing: ${transactionId}`);
    }

    this.transactions.set(transactionId, {
      ...existing,
      ...patch,
      status,
    });
  }

  public async get(transactionId: string): Promise<TransactionRecord | null> {
    return this.transactions.get(transactionId) ?? null;
  }

  public async listMessages(transactionId: string): Promise<TransactionMessageRecord[]> {
    return [...(this.messages.get(transactionId) ?? [])];
  }
}

export class InMemoryAuditJournalRepository implements AuditJournalRepository {
  private readonly records: AuditJournalRecord[] = [];

  public async append(record: AuditJournalRecord): Promise<void> {
    this.records.push(record);
  }

  public async listByTransaction(transactionId: string): Promise<AuditJournalRecord[]> {
    return this.records.filter((record) => record.transactionId === transactionId);
  }

  public async listAll(): Promise<AuditJournalRecord[]> {
    return [...this.records];
  }
}

export const kioskTransactionTableSql = `CREATE TABLE IF NOT EXISTS kiosk_transaction (
  id TEXT PRIMARY KEY,
  business_type TEXT NOT NULL,
  status TEXT NOT NULL,
  amount INTEGER,
  currency TEXT,
  session_id TEXT,
  flow_instance_id TEXT,
  trace_id TEXT,
  correlation_id TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  failed_at TEXT,
  result_code TEXT,
  result_message TEXT,
  metadata_json TEXT
);`;

export const kioskTransactionMessageTableSql = `CREATE TABLE IF NOT EXISTS kiosk_transaction_message (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  direction TEXT NOT NULL,
  message_type TEXT NOT NULL,
  channel TEXT,
  status TEXT,
  request_id TEXT,
  trace_id TEXT,
  correlation_id TEXT,
  payload_json TEXT,
  payload_hash TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(transaction_id) REFERENCES kiosk_transaction(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transaction_message_seq
ON kiosk_transaction_message(transaction_id, seq);`;

export const kioskAuditJournalTableSql = `CREATE TABLE IF NOT EXISTS kiosk_audit_journal (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  event_name TEXT,
  business_type TEXT,
  transaction_id TEXT,
  session_id TEXT,
  flow_instance_id TEXT,
  trace_id TEXT,
  message TEXT NOT NULL,
  data_json TEXT,
  created_at TEXT NOT NULL
);`;
