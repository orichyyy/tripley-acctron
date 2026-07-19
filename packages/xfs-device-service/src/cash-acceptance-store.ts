import type { CashAcceptanceRecord, CashAcceptanceStore } from "./cash-acceptance-contracts";

export class InMemoryCashAcceptanceStore implements CashAcceptanceStore {
  readonly #records = new Map<string, CashAcceptanceRecord>();

  async create(record: CashAcceptanceRecord): Promise<void> {
    if (this.#records.has(record.operationId)) throw new Error(`Operation exists: ${record.operationId}`);
    this.#records.set(record.operationId, Object.freeze({ ...record }));
  }

  async update(record: CashAcceptanceRecord): Promise<void> {
    if (!this.#records.has(record.operationId)) throw new Error(`Unknown operation: ${record.operationId}`);
    this.#records.set(record.operationId, Object.freeze({ ...record }));
  }

  async get(operationId: string): Promise<CashAcceptanceRecord | undefined> {
    return this.#records.get(operationId);
  }

  async listUnresolved(): Promise<readonly CashAcceptanceRecord[]> {
    return [...this.#records.values()].filter((record) => record.phase !== "completed" && record.phase !== "failed");
  }
}
