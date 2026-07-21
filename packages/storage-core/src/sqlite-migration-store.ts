import type { AppliedMigration, MigrationStore } from "./migrations";
import type { FrameworkSqliteConnection } from "./sqlite";

export const SQLITE_MIGRATION_JOURNAL_SQL = `
CREATE TABLE IF NOT EXISTS framework_schema_migration (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  applied_at TEXT NOT NULL
);`;

interface MigrationRow {
  readonly id: string;
  readonly package_id: string;
  readonly applied_at: string;
}

export class SqliteMigrationStore implements MigrationStore {
  public constructor(private readonly db: FrameworkSqliteConnection) {}

  public async migrate(): Promise<void> {
    await this.db.executeBatch(SQLITE_MIGRATION_JOURNAL_SQL);
  }

  public async listApplied(): Promise<readonly AppliedMigration[]> {
    const rows = await this.db.queryAll<MigrationRow>(
      "SELECT id, package_id, applied_at FROM framework_schema_migration ORDER BY id",
    );
    return rows.map((row) => ({
      appliedAt: row.applied_at,
      id: row.id,
      packageId: row.package_id,
    }));
  }

  public async markApplied(migration: AppliedMigration): Promise<void> {
    await this.db.run(
      `INSERT INTO framework_schema_migration (id, package_id, applied_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      [migration.id, migration.packageId, migration.appliedAt],
    );
  }
}

