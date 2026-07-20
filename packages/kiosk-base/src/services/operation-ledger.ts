import { FrameworkError } from "@tripley-kit/web-container-errors";
import type { JsonValue } from "@tripley-kit/web-container-types";

import type { Clock } from "./calendar";
import { systemClock } from "./calendar";

export type OperationStatus = "started" | "completed" | "failed" | "abandoned" | "intervention";

export type MediaCustodyStatus =
  | "none"
  | "acquired"
  | "presented"
  | "returned"
  | "retained"
  | "unknown";

export interface OperationLedgerRecord {
  readonly idempotencyKey: string;
  readonly operationType: string;
  readonly operationId?: string | undefined;
  readonly entryMethodId?: string | undefined;
  readonly phase?: string | undefined;
  readonly mediaCustody?: MediaCustodyStatus | undefined;
  readonly status: OperationStatus;
  readonly result?: JsonValue | undefined;
  readonly errorCode?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OperationStartDetails {
  readonly operationId?: string | undefined;
  readonly entryMethodId?: string | undefined;
  readonly phase?: string | undefined;
  readonly mediaCustody?: MediaCustodyStatus | undefined;
}

export interface OperationLedgerPatch {
  readonly phase?: string | undefined;
  readonly mediaCustody?: MediaCustodyStatus | undefined;
  readonly errorCode?: string | undefined;
  readonly result?: JsonValue | undefined;
  readonly status?: OperationStatus | undefined;
}

export interface OperationLedger {
  start(
    operationType: string,
    idempotencyKey: string,
    details?: OperationStartDetails,
  ): Promise<OperationLedgerRecord>;
  complete(idempotencyKey: string, result?: JsonValue): Promise<OperationLedgerRecord>;
  fail(idempotencyKey: string, errorCode: string): Promise<OperationLedgerRecord>;
  update(idempotencyKey: string, patch: OperationLedgerPatch): Promise<OperationLedgerRecord>;
  get(idempotencyKey: string): Promise<OperationLedgerRecord | null>;
  listActive(): Promise<OperationLedgerRecord[]>;
}

export class InMemoryOperationLedger implements OperationLedger {
  private readonly records = new Map<string, OperationLedgerRecord>();

  public constructor(private readonly clock: Clock = systemClock) {}

  public async start(
    operationType: string,
    idempotencyKey: string,
    details: OperationStartDetails = {},
  ): Promise<OperationLedgerRecord> {
    const existing = this.records.get(idempotencyKey);
    if (existing) {
      return existing;
    }
    const now = this.clock.now().toISOString();
    const record: OperationLedgerRecord = {
      createdAt: now,
      idempotencyKey,
      operationType,
      status: "started",
      updatedAt: now,
      ...details,
    };
    this.records.set(idempotencyKey, record);
    return record;
  }

  public async complete(
    idempotencyKey: string,
    result?: JsonValue,
  ): Promise<OperationLedgerRecord> {
    return this.update(idempotencyKey, { result, status: "completed" });
  }

  public async fail(idempotencyKey: string, errorCode: string): Promise<OperationLedgerRecord> {
    return this.update(idempotencyKey, { errorCode, status: "failed" });
  }

  public async update(
    idempotencyKey: string,
    patch: OperationLedgerPatch,
  ): Promise<OperationLedgerRecord> {
    const existing = this.records.get(idempotencyKey);
    if (!existing) {
      throw new FrameworkError({
        category: "dependency",
        code: "operationLedger.missing",
        message: `Operation ledger record is missing: ${idempotencyKey}`,
        metadata: { idempotencyKey },
      });
    }
    const updated: OperationLedgerRecord = {
      ...existing,
      ...patch,
      status: patch.status ?? existing.status,
      updatedAt: this.clock.now().toISOString(),
    };
    this.records.set(idempotencyKey, updated);
    return updated;
  }

  public async get(idempotencyKey: string): Promise<OperationLedgerRecord | null> {
    return this.records.get(idempotencyKey) ?? null;
  }

  public async listActive(): Promise<OperationLedgerRecord[]> {
    return [...this.records.values()].filter(
      (record) => record.status === "started" || record.status === "intervention",
    );
  }
}

export const kioskOperationLedgerTableSql = `CREATE TABLE IF NOT EXISTS kiosk_operation_ledger (
  idempotency_key TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;
