import { type ConfigKvStore, InMemoryConfigKvStore } from "./config-kv";
import { type CounterService, InMemoryCounterService } from "./counter";
import { DefaultMigrationRunner, type MigrationRunner } from "./migrations";
import { DefaultRepositoryRegistry, type RepositoryRegistry } from "./repositories";
import { DefaultSqliteConnectionRegistry, type SqliteConnectionRegistry } from "./sqlite";

export interface StorageRegistry {
  readonly sqlite: SqliteConnectionRegistry;
  readonly repositories: RepositoryRegistry;
  readonly migrations: MigrationRunner;
  readonly counters: CounterService;
  readonly configKv: ConfigKvStore;
}

export const createStorageRegistry = (): StorageRegistry => ({
  configKv: new InMemoryConfigKvStore(),
  counters: new InMemoryCounterService(),
  migrations: new DefaultMigrationRunner(),
  repositories: new DefaultRepositoryRegistry(),
  sqlite: new DefaultSqliteConnectionRegistry(),
});
