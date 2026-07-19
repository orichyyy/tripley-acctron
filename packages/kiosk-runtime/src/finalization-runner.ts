import type {
  FrozenFinalizationStep, OperationFinalizationContext, OperationFinalizationRecord,
  OperationFinalizationStore, OperationFinalizer,
} from "./finalization-contracts";

export class OperationFinalizerRegistry {
  readonly #finalizers = new Map<string, OperationFinalizer>();
  #frozen = false;

  register(finalizer: OperationFinalizer): this {
    if (this.#frozen) throw new Error("Operation finalizer registry is frozen");
    if (this.#finalizers.has(finalizer.id)) throw new Error(`Duplicate finalizer: ${finalizer.id}`);
    this.#finalizers.set(finalizer.id, finalizer);
    return this;
  }

  freeze(): readonly OperationFinalizer[] {
    this.#frozen = true;
    return Object.freeze(topologicalSort(this.#finalizers));
  }
}

export class OperationFinalizationRunner {
  readonly #plan: readonly OperationFinalizer[];
  readonly #planVersion: string;

  constructor(
    registry: OperationFinalizerRegistry,
    private readonly store: OperationFinalizationStore,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.#plan = registry.freeze();
    this.#planVersion = this.#plan.map((item) => `${item.id}@${item.version}`).join("|");
  }

  async run(context: OperationFinalizationContext): Promise<OperationFinalizationRecord> {
    let record = await this.store.load(context.operationId) ?? this.#newRecord(context.operationId);
    this.#assertCompatible(record);
    record = await this.#save({ ...record, status: "running" });

    for (const finalizer of this.#plan) {
      const step = record.steps.find((candidate) => candidate.id === finalizer.id);
      if (!step || step.status === "completed") continue;
      record = await this.#replaceStep(record, finalizer.id, {
        status: "running", attempts: step.attempts + 1, lastError: undefined,
      });
      try {
        await finalizer.execute(context);
        record = await this.#replaceStep(record, finalizer.id, { status: "completed" });
      } catch (error) {
        record = await this.#replaceStep(record, finalizer.id, {
          status: "failed", lastError: safeError(error),
        });
        await this.#save({ ...record, status: "failed" });
        throw error;
      }
    }
    return this.#save({ ...record, status: "completed" });
  }

  #newRecord(operationId: string): OperationFinalizationRecord {
    return {
      operationId, planVersion: this.#planVersion, status: "pending", updatedAt: this.now().toISOString(),
      steps: this.#plan.map((finalizer) => ({
        id: finalizer.id, version: finalizer.version, status: "pending", attempts: 0,
      })),
    };
  }

  #assertCompatible(record: OperationFinalizationRecord): void {
    if (record.planVersion !== this.#planVersion) {
      throw new Error(`Finalization plan mismatch for ${record.operationId}`);
    }
  }

  async #replaceStep(
    record: OperationFinalizationRecord,
    id: string,
    change: Partial<FrozenFinalizationStep>,
  ): Promise<OperationFinalizationRecord> {
    return this.#save({ ...record, steps: record.steps.map((step) => step.id === id ? { ...step, ...change } : step) });
  }

  async #save(record: OperationFinalizationRecord): Promise<OperationFinalizationRecord> {
    const updated = { ...record, updatedAt: this.now().toISOString() };
    await this.store.save(updated);
    return updated;
  }
}

export function createPromptCancelFinalizer(cancel: (operationId: string) => Promise<void>): OperationFinalizer {
  return { id: "runtime.prompt.cancel", version: "1", execute: ({ operationId }) => cancel(operationId) };
}

export function createScopedStoreResetFinalizer(reset: (operationId: string) => Promise<void>): OperationFinalizer {
  return {
    id: "runtime.scoped-store.reset", version: "1", after: ["runtime.prompt.cancel"],
    execute: ({ operationId }) => reset(operationId),
  };
}

function topologicalSort(source: ReadonlyMap<string, OperationFinalizer>): OperationFinalizer[] {
  const result: OperationFinalizer[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Finalizer dependency cycle at ${id}`);
    const item = source.get(id);
    if (!item) throw new Error(`Unknown finalizer dependency: ${id}`);
    visiting.add(id);
    for (const dependency of item.after ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    result.push(item);
  };
  for (const id of source.keys()) visit(id);
  return result;
}

function safeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "Unknown finalization error";
}
