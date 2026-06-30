import type { FrameworkSqliteConnection } from "./sqlite";

export interface Migration {
  readonly id: string;
  readonly packageId: string;
  up(db: FrameworkSqliteConnection): Promise<void>;
  down?(db: FrameworkSqliteConnection): Promise<void>;
}

export interface AppliedMigration {
  readonly id: string;
  readonly packageId: string;
  readonly appliedAt: string;
}

export interface MigrationStore {
  listApplied(): Promise<readonly AppliedMigration[]>;
  markApplied(migration: AppliedMigration): Promise<void>;
}

export interface MigrationRunner {
  register(migration: Migration): void;
  list(): readonly Migration[];
  runPending(db: FrameworkSqliteConnection): Promise<readonly AppliedMigration[]>;
}

export class InMemoryMigrationStore implements MigrationStore {
  private readonly applied = new Map<string, AppliedMigration>();

  public async listApplied(): Promise<readonly AppliedMigration[]> {
    return [...this.applied.values()];
  }

  public async markApplied(migration: AppliedMigration): Promise<void> {
    this.applied.set(migration.id, migration);
  }
}

export class DefaultMigrationRunner implements MigrationRunner {
  private readonly migrations = new Map<string, Migration>();

  public constructor(private readonly store: MigrationStore = new InMemoryMigrationStore()) {}

  public register(migration: Migration): void {
    if (this.migrations.has(migration.id)) {
      throw new Error(`Migration already registered: ${migration.id}`);
    }

    this.migrations.set(migration.id, migration);
  }

  public list(): readonly Migration[] {
    return [...this.migrations.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  public async runPending(db: FrameworkSqliteConnection): Promise<readonly AppliedMigration[]> {
    const appliedIds = new Set((await this.store.listApplied()).map((migration) => migration.id));
    const appliedNow: AppliedMigration[] = [];
    for (const migration of this.list()) {
      if (appliedIds.has(migration.id)) {
        continue;
      }

      await migration.up(db);
      const applied = {
        appliedAt: new Date().toISOString(),
        id: migration.id,
        packageId: migration.packageId,
      };
      await this.store.markApplied(applied);
      appliedNow.push(applied);
    }

    return appliedNow;
  }
}
