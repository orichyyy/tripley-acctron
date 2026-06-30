export interface RepositoryRegistry {
  register<TRepository>(id: string, repository: TRepository): void;
  get<TRepository>(id: string): TRepository | undefined;
  require<TRepository>(id: string): TRepository;
  list(): readonly string[];
}

export class DefaultRepositoryRegistry implements RepositoryRegistry {
  private readonly repositories = new Map<string, unknown>();

  public register<TRepository>(id: string, repository: TRepository): void {
    if (this.repositories.has(id)) {
      throw new Error(`Repository already registered: ${id}`);
    }

    this.repositories.set(id, repository);
  }

  public get<TRepository>(id: string): TRepository | undefined {
    return this.repositories.get(id) as TRepository | undefined;
  }

  public require<TRepository>(id: string): TRepository {
    const repository = this.get<TRepository>(id);
    if (!repository) {
      throw new Error(`Repository is not registered: ${id}`);
    }

    return repository;
  }

  public list(): readonly string[] {
    return [...this.repositories.keys()];
  }
}
