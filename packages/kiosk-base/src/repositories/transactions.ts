import type { JsonValue, Metadata } from "@tripley-kit/web-container-types";

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

export interface CreateTransactionInput extends Omit<TransactionRecord, "startedAt" | "status"> {}

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

export interface AppendTransactionMessageInput
  extends Omit<TransactionMessageRecord, "createdAt" | "seq" | "transactionId"> {}

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

export class InMemoryTransactionRepository implements TransactionRepository {
  private readonly transactions = new Map<string, TransactionRecord>();
  private readonly messages = new Map<string, TransactionMessageRecord[]>();

  public async create(input: CreateTransactionInput): Promise<TransactionRecord> {
    const record = {
      ...input,
      startedAt: new Date().toISOString(),
      status: "started",
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
      ...message,
      createdAt: new Date().toISOString(),
      seq: messages.length + 1,
      transactionId,
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
    this.transactions.set(transactionId, { ...existing, ...patch, status });
  }

  public async get(transactionId: string): Promise<TransactionRecord | null> {
    return this.transactions.get(transactionId) ?? null;
  }

  public async listMessages(transactionId: string): Promise<TransactionMessageRecord[]> {
    return [...(this.messages.get(transactionId) ?? [])];
  }
}
