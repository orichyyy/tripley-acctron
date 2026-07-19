import type { CashAcceptanceRecord, CashAcceptanceStore } from "./cash-acceptance-contracts";

export const CASH_ACCEPTANCE_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS xfs_cash_acceptance_operation (
  operation_id TEXT PRIMARY KEY,
  logical_service TEXT NOT NULL,
  resource_group TEXT NOT NULL,
  phase TEXT NOT NULL,
  revision INTEGER NOT NULL,
  snapshot_hash TEXT,
  authorization_revision INTEGER,
  authorization_hash TEXT,
  physical_commit_dispatched INTEGER NOT NULL,
  terminal_reason TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_xfs_cash_acceptance_unresolved_resource_group
ON xfs_cash_acceptance_operation(resource_group)
WHERE phase NOT IN ('completed', 'failed');`;

export interface CashAcceptanceSqlPort {
  execute(sql: string, parameters?: readonly unknown[]): Promise<void>;
  query<T>(sql: string, parameters?: readonly unknown[]): Promise<readonly T[]>;
}

interface Row {
  operation_id: string;
  logical_service: string;
  phase: CashAcceptanceRecord["phase"];
  revision: number;
  snapshot_hash: string | null;
  authorization_revision: number | null;
  authorization_hash: string | null;
  physical_commit_dispatched: number;
  terminal_reason: CashAcceptanceRecord["terminalReason"] | null;
  updated_at: string;
}

export class SqlCashAcceptanceStore implements CashAcceptanceStore {
  constructor(private readonly sql: CashAcceptanceSqlPort, private readonly resourceGroup: string) {}

  async migrate(): Promise<void> { await this.sql.execute(CASH_ACCEPTANCE_MIGRATION_SQL); }

  async create(record: CashAcceptanceRecord): Promise<void> {
    await this.sql.execute(
      `INSERT INTO xfs_cash_acceptance_operation
       (operation_id, logical_service, resource_group, phase, revision, snapshot_hash,
        authorization_revision, authorization_hash, physical_commit_dispatched, terminal_reason, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      values(record, this.resourceGroup),
    );
  }

  async update(record: CashAcceptanceRecord): Promise<void> {
    await this.sql.execute(
      `UPDATE xfs_cash_acceptance_operation SET logical_service = ?, resource_group = ?, phase = ?,
       revision = ?, snapshot_hash = ?, authorization_revision = ?, authorization_hash = ?,
       physical_commit_dispatched = ?, terminal_reason = ?, updated_at = ? WHERE operation_id = ?`,
      [...values(record, this.resourceGroup).slice(1), record.operationId],
    );
  }

  async get(operationId: string): Promise<CashAcceptanceRecord | undefined> {
    const rows = await this.sql.query<Row>(
      "SELECT * FROM xfs_cash_acceptance_operation WHERE operation_id = ?",
      [operationId],
    );
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async listUnresolved(): Promise<readonly CashAcceptanceRecord[]> {
    const rows = await this.sql.query<Row>(
      "SELECT * FROM xfs_cash_acceptance_operation WHERE phase NOT IN ('completed', 'failed')",
    );
    return rows.map(fromRow);
  }
}

function values(record: CashAcceptanceRecord, resourceGroup: string): readonly unknown[] {
  return [record.operationId, record.logicalService, resourceGroup, record.phase, record.revision,
    record.snapshotHash ?? null, record.authorizationRevision ?? null, record.authorizationHash ?? null,
    record.physicalCommitDispatched ? 1 : 0, record.terminalReason ?? null, record.updatedAt];
}

function fromRow(row: Row): CashAcceptanceRecord {
  return {
    operationId: row.operation_id, logicalService: row.logical_service, phase: row.phase,
    revision: row.revision, snapshotHash: row.snapshot_hash ?? undefined,
    authorizationRevision: row.authorization_revision ?? undefined,
    authorizationHash: row.authorization_hash ?? undefined,
    physicalCommitDispatched: row.physical_commit_dispatched === 1,
    terminalReason: row.terminal_reason ?? undefined, updatedAt: row.updated_at,
  };
}
