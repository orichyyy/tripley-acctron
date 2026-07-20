import { FrameworkError } from "@tripley/web-container-errors";
import type { FrameworkSqliteConnection, Migration } from "@tripley/web-container-storage-core";

import type {
  HostProtectionJournalRecord,
  ProtectionRecoveryCase,
  ProtectionRecoveryCaseState,
  ProtectionRecoveryImportedRecord,
  ProtectionRecoveryStorePort,
} from "./protection-recovery-contracts";
import {
  protectionRecoveryCaseId,
  protectionRecoveryImportId,
} from "./protection-recovery-contracts";

export const protectionRecoverySchemaSql = `CREATE TABLE IF NOT EXISTS xfs_protection_recovery_case (
  id TEXT PRIMARY KEY,
  host_epoch TEXT NOT NULL,
  resource_group TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL,
  phase TEXT NOT NULL,
  custody_outcome TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  profile_version TEXT NOT NULL,
  profile_hash TEXT NOT NULL,
  deadline_epoch_ms INTEGER,
  classification TEXT NOT NULL,
  state TEXT NOT NULL,
  journal_record_ids_json TEXT NOT NULL,
  intervention_reason TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_xfs_protection_recovery_open_group
ON xfs_protection_recovery_case(resource_group) WHERE state <> 'acknowledged';
CREATE TABLE IF NOT EXISTS xfs_protection_recovery_record (
  import_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  record_json TEXT NOT NULL,
  FOREIGN KEY(case_id) REFERENCES xfs_protection_recovery_case(id)
);
CREATE TABLE IF NOT EXISTS xfs_protection_recovery_projection (
  import_id TEXT NOT NULL,
  projection_id TEXT NOT NULL,
  projected_at TEXT NOT NULL,
  PRIMARY KEY(import_id, projection_id),
  FOREIGN KEY(import_id) REFERENCES xfs_protection_recovery_record(import_id)
);`;

export const xfsProtectionRecoveryMigrations: readonly Migration[] = [
  {
    id: "xfs-device-service.002.protection-recovery",
    packageId: "@tripley/web-container-xfs-device-service",
    up: (db) => db.executeBatch(protectionRecoverySchemaSql),
  },
];

export class InMemoryProtectionRecoveryStore implements ProtectionRecoveryStorePort {
  private readonly cases = new Map<string, ProtectionRecoveryCase>();
  private readonly records = new Map<string, ProtectionRecoveryImportedRecord>();
  private readonly projections = new Set<string>();

  public async getOpenCase(resourceGroup: string): Promise<ProtectionRecoveryCase | null> {
    return (
      [...this.cases.values()].find(
        (item) => item.resourceGroup === resourceGroup && item.state !== "acknowledged",
      ) ?? null
    );
  }

  public async ingest(
    input: Parameters<ProtectionRecoveryStorePort["ingest"]>[0],
  ): ReturnType<ProtectionRecoveryStorePort["ingest"]> {
    const id = protectionRecoveryCaseId(
      input.hostEpoch,
      input.status.resourceGroup,
      input.status.operationId,
    );
    const open = await this.getOpenCase(input.status.resourceGroup);
    if (open && open.id !== id) throw recoveryConflict(input.status.resourceGroup);
    const imported = input.records.map((record) =>
      this.importRecord(id, input.hostEpoch, record, input.importedAt),
    );
    const previous = this.cases.get(id);
    const journalRecordIds = [
      ...new Set([
        ...(previous?.journalRecordIds ?? []),
        ...imported.map((record) => record.importId),
      ]),
    ];
    const recoveryCase: ProtectionRecoveryCase = Object.freeze({
      classification: input.classification,
      custodyOutcome: input.status.custodyOutcome,
      ...(input.status.deadlineEpochMs === undefined
        ? {}
        : { deadlineEpochMs: input.status.deadlineEpochMs }),
      fencingToken: input.status.fencingToken,
      hostEpoch: input.hostEpoch,
      id,
      ...(previous?.interventionReason ? { interventionReason: previous.interventionReason } : {}),
      journalRecordIds,
      operationId: input.status.operationId,
      phase: input.status.phase,
      profileHash: input.status.protectionPolicyProfileHash,
      profileId: input.status.protectionPolicyProfileId,
      profileVersion: input.status.protectionPolicyProfileVersion,
      resourceGroup: input.status.resourceGroup,
      state: previous?.state ?? "observed",
      updatedAt: input.importedAt,
    });
    this.cases.set(id, recoveryCase);
    return { records: imported, recoveryCase };
  }

  public async listImported(caseId: string): Promise<readonly ProtectionRecoveryImportedRecord[]> {
    return [...this.records.values()].filter((record) => record.caseId === caseId);
  }

  public async isProjected(importId: string, projectionId: string): Promise<boolean> {
    return this.projections.has(projectionKey(importId, projectionId));
  }

  public async markProjected(importId: string, projectionId: string): Promise<void> {
    if (!this.records.has(importId)) throw recoveryMissing(importId);
    this.projections.add(projectionKey(importId, projectionId));
  }

  public markAckPending(caseId: string, updatedAt: string): Promise<ProtectionRecoveryCase> {
    return this.updateState(caseId, "ackPending", updatedAt);
  }

  public markAcknowledged(caseId: string, updatedAt: string): Promise<ProtectionRecoveryCase> {
    return this.updateState(caseId, "acknowledged", updatedAt);
  }

  public markIntervention(
    caseId: string,
    reasonCode: string,
    updatedAt: string,
  ): Promise<ProtectionRecoveryCase> {
    return this.updateState(caseId, "intervention", updatedAt, reasonCode);
  }

  private importRecord(
    caseId: string,
    hostEpoch: string,
    record: HostProtectionJournalRecord,
    importedAt: string,
  ): ProtectionRecoveryImportedRecord {
    const importId = protectionRecoveryImportId(caseId, record.id);
    const existing = this.records.get(importId);
    if (existing) return existing;
    const imported = Object.freeze({ ...record, caseId, hostEpoch, importId, importedAt });
    this.records.set(importId, imported);
    return imported;
  }

  private async updateState(
    caseId: string,
    state: ProtectionRecoveryCaseState,
    updatedAt: string,
    interventionReason?: string,
  ): Promise<ProtectionRecoveryCase> {
    const current = this.cases.get(caseId);
    if (!current) throw recoveryMissing(caseId);
    const updated = Object.freeze({
      ...current,
      ...(interventionReason === undefined ? {} : { interventionReason }),
      state,
      updatedAt,
    });
    this.cases.set(caseId, updated);
    return updated;
  }
}

export class SqliteProtectionRecoveryStore implements ProtectionRecoveryStorePort {
  public constructor(private readonly db: FrameworkSqliteConnection) {}

  public async getOpenCase(resourceGroup: string): Promise<ProtectionRecoveryCase | null> {
    const row = await this.db.queryOne<ProtectionRecoveryCaseRow>(
      "SELECT * FROM xfs_protection_recovery_case WHERE resource_group = ? AND state <> 'acknowledged' ORDER BY updated_at DESC LIMIT 1",
      [resourceGroup],
    );
    return row ? caseFromRow(row) : null;
  }

  public async ingest(
    input: Parameters<ProtectionRecoveryStorePort["ingest"]>[0],
  ): ReturnType<ProtectionRecoveryStorePort["ingest"]> {
    const id = protectionRecoveryCaseId(
      input.hostEpoch,
      input.status.resourceGroup,
      input.status.operationId,
    );
    const open = await this.getOpenCase(input.status.resourceGroup);
    if (open && open.id !== id) throw recoveryConflict(input.status.resourceGroup);
    await this.db.transaction(async (tx) => {
      const importedIds = input.records.map((record) => protectionRecoveryImportId(id, record.id));
      const ids = [...new Set([...(open?.journalRecordIds ?? []), ...importedIds])];
      await tx.run(
        `INSERT INTO xfs_protection_recovery_case (
          id, host_epoch, resource_group, operation_id, fencing_token, phase, custody_outcome,
          profile_id, profile_version, profile_hash, deadline_epoch_ms, classification, state,
          journal_record_ids_json, intervention_reason, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          fencing_token = excluded.fencing_token, phase = excluded.phase,
          custody_outcome = excluded.custody_outcome, deadline_epoch_ms = excluded.deadline_epoch_ms,
          classification = excluded.classification,
          journal_record_ids_json = excluded.journal_record_ids_json, updated_at = excluded.updated_at`,
        [
          id,
          input.hostEpoch,
          input.status.resourceGroup,
          input.status.operationId,
          input.status.fencingToken,
          input.status.phase,
          input.status.custodyOutcome,
          input.status.protectionPolicyProfileId,
          input.status.protectionPolicyProfileVersion,
          input.status.protectionPolicyProfileHash,
          input.status.deadlineEpochMs ?? null,
          input.classification,
          open?.state ?? "observed",
          JSON.stringify(ids),
          open?.interventionReason ?? null,
          input.importedAt,
        ],
      );
      for (const record of input.records) {
        const imported = importedRecord(id, input.hostEpoch, record, input.importedAt);
        await tx.run(
          "INSERT OR IGNORE INTO xfs_protection_recovery_record (import_id, case_id, record_json) VALUES (?, ?, ?)",
          [imported.importId, id, JSON.stringify(imported)],
        );
      }
    });
    const recoveryCase = await this.requireCase(id);
    return { records: await this.listImported(id), recoveryCase };
  }

  public async listImported(caseId: string): Promise<readonly ProtectionRecoveryImportedRecord[]> {
    const rows = await this.db.queryAll<{ record_json: string }>(
      "SELECT record_json FROM xfs_protection_recovery_record WHERE case_id = ? ORDER BY rowid",
      [caseId],
    );
    return rows.map((row) => JSON.parse(row.record_json) as ProtectionRecoveryImportedRecord);
  }

  public async isProjected(importId: string, projectionId: string): Promise<boolean> {
    return Boolean(
      await this.db.queryOne<{ projected_at: string }>(
        "SELECT projected_at FROM xfs_protection_recovery_projection WHERE import_id = ? AND projection_id = ?",
        [importId, projectionId],
      ),
    );
  }

  public async markProjected(
    importId: string,
    projectionId: string,
    projectedAt: string,
  ): Promise<void> {
    await this.db.run(
      "INSERT OR IGNORE INTO xfs_protection_recovery_projection (import_id, projection_id, projected_at) VALUES (?, ?, ?)",
      [importId, projectionId, projectedAt],
    );
  }

  public markAckPending(caseId: string, updatedAt: string): Promise<ProtectionRecoveryCase> {
    return this.updateState(caseId, "ackPending", updatedAt);
  }

  public markAcknowledged(caseId: string, updatedAt: string): Promise<ProtectionRecoveryCase> {
    return this.updateState(caseId, "acknowledged", updatedAt);
  }

  public markIntervention(
    caseId: string,
    reasonCode: string,
    updatedAt: string,
  ): Promise<ProtectionRecoveryCase> {
    return this.updateState(caseId, "intervention", updatedAt, reasonCode);
  }

  private async updateState(
    caseId: string,
    state: ProtectionRecoveryCaseState,
    updatedAt: string,
    interventionReason?: string,
  ): Promise<ProtectionRecoveryCase> {
    const current = await this.requireCase(caseId);
    await this.db.run(
      "UPDATE xfs_protection_recovery_case SET state = ?, intervention_reason = ?, updated_at = ? WHERE id = ?",
      [state, interventionReason ?? current.interventionReason ?? null, updatedAt, caseId],
    );
    return this.requireCase(caseId);
  }

  private async requireCase(caseId: string): Promise<ProtectionRecoveryCase> {
    const row = await this.db.queryOne<ProtectionRecoveryCaseRow>(
      "SELECT * FROM xfs_protection_recovery_case WHERE id = ?",
      [caseId],
    );
    if (!row) throw recoveryMissing(caseId);
    return caseFromRow(row);
  }
}

interface ProtectionRecoveryCaseRow {
  readonly id: string;
  readonly host_epoch: string;
  readonly resource_group: string;
  readonly operation_id: string;
  readonly fencing_token: number;
  readonly phase: string;
  readonly custody_outcome: string;
  readonly profile_id: string;
  readonly profile_version: string;
  readonly profile_hash: string;
  readonly deadline_epoch_ms: number | null;
  readonly classification: ProtectionRecoveryCase["classification"];
  readonly state: ProtectionRecoveryCaseState;
  readonly journal_record_ids_json: string;
  readonly intervention_reason: string | null;
  readonly updated_at: string;
}

const caseFromRow = (row: ProtectionRecoveryCaseRow): ProtectionRecoveryCase => ({
  classification: row.classification,
  custodyOutcome: row.custody_outcome,
  ...(row.deadline_epoch_ms === null ? {} : { deadlineEpochMs: row.deadline_epoch_ms }),
  fencingToken: row.fencing_token,
  hostEpoch: row.host_epoch,
  id: row.id,
  ...(row.intervention_reason === null ? {} : { interventionReason: row.intervention_reason }),
  journalRecordIds: JSON.parse(row.journal_record_ids_json) as string[],
  operationId: row.operation_id,
  phase: row.phase,
  profileHash: row.profile_hash,
  profileId: row.profile_id,
  profileVersion: row.profile_version,
  resourceGroup: row.resource_group,
  state: row.state,
  updatedAt: row.updated_at,
});

const importedRecord = (
  caseId: string,
  hostEpoch: string,
  record: HostProtectionJournalRecord,
  importedAt: string,
): ProtectionRecoveryImportedRecord => ({
  ...record,
  caseId,
  hostEpoch,
  importId: protectionRecoveryImportId(caseId, record.id),
  importedAt,
});

const projectionKey = (importId: string, projectionId: string): string =>
  `${importId}\u001f${projectionId}`;

const recoveryMissing = (id: string): FrameworkError =>
  new FrameworkError({
    category: "storage",
    code: "xfs.protectionRecovery.recordMissing",
    message: "Protection recovery record is missing.",
    metadata: { id },
  });

const recoveryConflict = (resourceGroup: string): FrameworkError =>
  new FrameworkError({
    category: "storage",
    code: "xfs.protectionRecovery.openCaseConflict",
    message: "A resource group already has a different open protection recovery case.",
    metadata: { resourceGroup },
  });
