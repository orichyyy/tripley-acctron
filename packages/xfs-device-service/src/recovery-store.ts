import type {
  FrameworkSqliteConnection,
  Migration,
  SqliteValue,
} from "@tripley-kit/web-container-storage-core";

import type {
  CashRecoveryLeaseCreateInput,
  CashRecoveryLeasePatch,
  CashRecoveryLeaseRecord,
  CashRecoveryLeaseStorePort,
} from "./recovery-contracts";
import type {
  CashCustodyOutcome,
  CashDeliveryPhase,
  CashRecoveryLease,
  CashRecoveryLeasePort,
} from "./cash-contracts";

export const cashRecoveryLeaseTableSql = `CREATE TABLE IF NOT EXISTS xfs_cash_recovery_lease (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  cash_session_id TEXT NOT NULL,
  module TEXT NOT NULL,
  logical_service TEXT NOT NULL,
  owner_instance_id TEXT NOT NULL,
  authority TEXT NOT NULL,
  state TEXT NOT NULL,
  phase TEXT NOT NULL,
  evidence_sequence INTEGER NOT NULL,
  fencing_token INTEGER NOT NULL,
  pending_fencing_token INTEGER,
  host_epoch TEXT,
  recovery_deadline_at TEXT NOT NULL,
  revision INTEGER NOT NULL,
  outcome TEXT,
  intervention_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_xfs_cash_recovery_unresolved
ON xfs_cash_recovery_lease(logical_service) WHERE state <> 'closed';`;

export const xfsCashRecoveryMigrations: readonly Migration[] = [
  {
    id: "xfs-device-service.001.cash-recovery-lease",
    packageId: "@tripley-kit/web-container-xfs-device-service",
    up: async (db) => db.executeBatch(cashRecoveryLeaseTableSql),
  },
  {
    id: "xfs-device-service.002.unresolved-lease-uniqueness",
    packageId: "@tripley-kit/web-container-xfs-device-service",
    up: async (db) => db.executeBatch(`DROP INDEX IF EXISTS idx_xfs_cash_recovery_unresolved;
CREATE UNIQUE INDEX idx_xfs_cash_recovery_unresolved
ON xfs_cash_recovery_lease(logical_service) WHERE state <> 'closed';`),
  },
];

export class InMemoryCashRecoveryLeaseStore implements CashRecoveryLeaseStorePort {
  private readonly records = new Map<string, CashRecoveryLeaseRecord>();

  public async create(input: CashRecoveryLeaseCreateInput): Promise<CashRecoveryLeaseRecord> {
    if (this.records.has(input.id)) throw new Error(`Cash recovery lease exists: ${input.id}`);
    if ([...this.records.values()].some((record) =>
      record.logicalService === input.logicalService && record.state !== "closed")) {
      throw new Error(`Cash recovery is unresolved: ${input.logicalService}`);
    }
    const record = createRecord(input);
    this.records.set(record.id, record);
    return record;
  }

  public async get(id: string): Promise<CashRecoveryLeaseRecord | null> {
    return this.records.get(id) ?? null;
  }

  public async listUnresolved(logicalService?: string): Promise<readonly CashRecoveryLeaseRecord[]> {
    return [...this.records.values()].filter((record) =>
      record.state !== "closed" && (!logicalService || record.logicalService === logicalService));
  }

  public async compareAndSwap(input: {
    readonly id: string;
    readonly expectedRevision: number;
    readonly expectedOwnerInstanceId?: string | undefined;
    readonly patch: CashRecoveryLeasePatch;
    readonly updatedAt: string;
  }): Promise<CashRecoveryLeaseRecord | null> {
    const current = this.records.get(input.id);
    if (!current || current.revision !== input.expectedRevision) return null;
    if (input.expectedOwnerInstanceId && current.ownerInstanceId !== input.expectedOwnerInstanceId) {
      return null;
    }
    const updated = Object.freeze({
      ...current,
      ...input.patch,
      revision: current.revision + 1,
      updatedAt: input.updatedAt,
    });
    this.records.set(updated.id, updated);
    return updated;
  }
}

export class SqliteCashRecoveryLeaseStore implements CashRecoveryLeaseStorePort {
  public constructor(private readonly db: FrameworkSqliteConnection) {}

  public async create(input: CashRecoveryLeaseCreateInput): Promise<CashRecoveryLeaseRecord> {
    const record = createRecord(input);
    await this.db.run(
      `INSERT INTO xfs_cash_recovery_lease
      (id, operation_id, cash_session_id, module, logical_service, owner_instance_id, authority,
       state, phase, evidence_sequence, fencing_token, recovery_deadline_at, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      recordParams(record).slice(0, 15),
    );
    return record;
  }

  public async get(id: string): Promise<CashRecoveryLeaseRecord | null> {
    const row = await this.db.queryOne<CashRecoveryRow>(
      "SELECT * FROM xfs_cash_recovery_lease WHERE id = ?",
      [id],
    );
    return row ? fromRow(row) : null;
  }

  public async listUnresolved(logicalService?: string): Promise<readonly CashRecoveryLeaseRecord[]> {
    const rows = await this.db.queryAll<CashRecoveryRow>(
      logicalService
        ? "SELECT * FROM xfs_cash_recovery_lease WHERE state <> 'closed' AND logical_service = ?"
        : "SELECT * FROM xfs_cash_recovery_lease WHERE state <> 'closed'",
      logicalService ? [logicalService] : [],
    );
    return rows.map(fromRow);
  }

  public async compareAndSwap(input: {
    readonly id: string;
    readonly expectedRevision: number;
    readonly expectedOwnerInstanceId?: string | undefined;
    readonly patch: CashRecoveryLeasePatch;
    readonly updatedAt: string;
  }): Promise<CashRecoveryLeaseRecord | null> {
    const current = await this.get(input.id);
    if (!current || current.revision !== input.expectedRevision) return null;
    if (input.expectedOwnerInstanceId && current.ownerInstanceId !== input.expectedOwnerInstanceId) {
      return null;
    }
    const updated: CashRecoveryLeaseRecord = {
      ...current,
      ...input.patch,
      revision: current.revision + 1,
      updatedAt: input.updatedAt,
    };
    const ownerClause = input.expectedOwnerInstanceId ? " AND owner_instance_id = ?" : "";
    const params = [
      updated.ownerInstanceId, updated.authority, updated.state, updated.phase,
      updated.evidenceSequence, updated.fencingToken, updated.pendingFencingToken ?? null,
      updated.hostEpoch ?? null, updated.outcome ?? null, updated.interventionReason ?? null,
      updated.revision, updated.updatedAt, input.id, input.expectedRevision,
      ...(input.expectedOwnerInstanceId ? [input.expectedOwnerInstanceId] : []),
    ] satisfies SqliteValue[];
    const result = await this.db.run(
      `UPDATE xfs_cash_recovery_lease SET owner_instance_id = ?, authority = ?, state = ?,
       phase = ?, evidence_sequence = ?, fencing_token = ?, pending_fencing_token = ?,
       host_epoch = ?, outcome = ?, intervention_reason = ?, revision = ?, updated_at = ?
       WHERE id = ? AND revision = ?${ownerClause}`,
      params,
    );
    return result.changes === 0 ? null : updated;
  }
}

export class DurableCashRecoveryLeaseAdapter implements CashRecoveryLeasePort {
  public constructor(
    private readonly store: CashRecoveryLeaseStorePort,
    private readonly options: {
      readonly deadlineMs: number;
      readonly now?: () => Date;
      readonly idFactory?: () => string;
    },
  ) {}

  public async hasUnresolved(logicalService: string): Promise<boolean> {
    return (await this.store.listUnresolved(logicalService)).length > 0;
  }

  public async acquire(input: {
    readonly operationId: string;
    readonly cashSessionId: string;
    readonly logicalService: string;
    readonly ownerInstanceId: string;
  }): Promise<CashRecoveryLease> {
    const now = this.now();
    const record = await this.store.create({
      ...input,
      createdAt: now.toISOString(),
      fencingToken: 1,
      id: this.options.idFactory?.() ?? input.cashSessionId,
      module: "cdm",
      recoveryDeadlineAt: new Date(now.getTime() + this.options.deadlineMs).toISOString(),
    });
    return leaseView(record);
  }

  public async update(
    lease: CashRecoveryLease,
    phase: CashDeliveryPhase,
    sequence: number,
  ): Promise<void> {
    const current = await this.require(lease.id);
    await this.swap(current, { evidenceSequence: sequence, phase });
  }

  public async close(lease: CashRecoveryLease, outcome: CashCustodyOutcome): Promise<void> {
    const current = await this.require(lease.id);
    await this.swap(current, { outcome, state: "closed" });
  }

  private async require(id: string): Promise<CashRecoveryLeaseRecord> {
    const record = await this.store.get(id);
    if (!record) throw new Error(`Cash recovery lease is missing: ${id}`);
    return record;
  }

  private async swap(
    current: CashRecoveryLeaseRecord,
    patch: CashRecoveryLeasePatch,
  ): Promise<CashRecoveryLeaseRecord> {
    const updated = await this.store.compareAndSwap({
      expectedOwnerInstanceId: current.ownerInstanceId,
      expectedRevision: current.revision,
      id: current.id,
      patch,
      updatedAt: this.now().toISOString(),
    });
    if (!updated) throw new Error(`Cash recovery lease fencing conflict: ${current.id}`);
    return updated;
  }

  private now(): Date { return this.options.now?.() ?? new Date(); }
}

interface CashRecoveryRow {
  id: string; operation_id: string; cash_session_id: string; module: string;
  logical_service: string; owner_instance_id: string; authority: CashRecoveryLeaseRecord["authority"];
  state: CashRecoveryLeaseRecord["state"]; phase: CashDeliveryPhase; evidence_sequence: number;
  fencing_token: number; pending_fencing_token: number | null; host_epoch: string | null;
  recovery_deadline_at: string; revision: number; outcome: CashCustodyOutcome | null;
  intervention_reason: string | null; created_at: string; updated_at: string;
}

const createRecord = (input: CashRecoveryLeaseCreateInput): CashRecoveryLeaseRecord => Object.freeze({
  ...input,
  authority: "transaction" as const,
  evidenceSequence: 0,
  phase: "planning" as const,
  revision: 1,
  state: "transactionBound" as const,
  updatedAt: input.createdAt,
});

const leaseView = (record: CashRecoveryLeaseRecord): CashRecoveryLease => ({
  cashSessionId: record.cashSessionId,
  fencingToken: record.fencingToken,
  id: record.id,
  logicalService: record.logicalService,
  operationId: record.operationId,
  ownerInstanceId: record.ownerInstanceId,
  revision: record.revision,
});

const fromRow = (row: CashRecoveryRow): CashRecoveryLeaseRecord => ({
  authority: row.authority, cashSessionId: row.cash_session_id, createdAt: row.created_at,
  evidenceSequence: row.evidence_sequence, fencingToken: row.fencing_token,
  hostEpoch: row.host_epoch ?? undefined, id: row.id,
  interventionReason: row.intervention_reason ?? undefined, logicalService: row.logical_service,
  module: row.module, operationId: row.operation_id, outcome: row.outcome ?? undefined,
  ownerInstanceId: row.owner_instance_id, pendingFencingToken: row.pending_fencing_token ?? undefined,
  phase: row.phase, recoveryDeadlineAt: row.recovery_deadline_at, revision: row.revision,
  state: row.state, updatedAt: row.updated_at,
});

const recordParams = (record: CashRecoveryLeaseRecord): SqliteValue[] => [
  record.id, record.operationId, record.cashSessionId, record.module, record.logicalService,
  record.ownerInstanceId, record.authority, record.state, record.phase, record.evidenceSequence,
  record.fencingToken, record.recoveryDeadlineAt, record.revision, record.createdAt, record.updatedAt,
];
