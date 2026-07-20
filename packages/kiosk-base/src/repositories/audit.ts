import type { JsonValue } from "@tripley-kit/web-container-types";

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
