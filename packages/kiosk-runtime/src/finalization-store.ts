import type { OperationFinalizationRecord, OperationFinalizationStore } from "./finalization-contracts";

export class InMemoryOperationFinalizationStore implements OperationFinalizationStore {
  readonly #records = new Map<string, OperationFinalizationRecord>();

  async load(operationId: string): Promise<OperationFinalizationRecord | undefined> {
    return this.#records.get(operationId);
  }

  async save(record: OperationFinalizationRecord): Promise<void> {
    this.#records.set(record.operationId, freezeRecord(record));
  }

  async listIncomplete(): Promise<readonly OperationFinalizationRecord[]> {
    return [...this.#records.values()].filter((record) => record.status !== "completed");
  }
}

function freezeRecord(record: OperationFinalizationRecord): OperationFinalizationRecord {
  return Object.freeze({ ...record, steps: Object.freeze(record.steps.map((step) => Object.freeze({ ...step }))) });
}
