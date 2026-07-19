import type {
  CashAcceptanceAuthorization, CashAcceptanceAuthorizer, CashAcceptanceEntryGate,
  CashAcceptanceEvidencePort, CashAcceptanceLeasePort, CashAcceptanceLeaseSession,
  CashAcceptancePhase, CashAcceptanceRecord,
  CashAcceptanceResult, CashAcceptanceSession, CashAcceptanceSnapshot,
  CashAcceptanceStartRequest, CashAcceptanceStore, CimCashInClient,
} from "./cash-acceptance-contracts";
import { assertExactAuthorization, CashAcceptanceAuthorizationError, createEscrowSnapshot } from "./cash-acceptance-policy";

export interface CashAcceptanceServiceDependencies {
  readonly client: CimCashInClient;
  readonly entryGate: CashAcceptanceEntryGate;
  readonly evidence: CashAcceptanceEvidencePort;
  readonly leases: CashAcceptanceLeasePort;
  readonly store: CashAcceptanceStore;
  readonly now?: () => Date;
}

export class CashAcceptanceService {
  constructor(private readonly dependencies: CashAcceptanceServiceDependencies) {}

  async start(request: CashAcceptanceStartRequest): Promise<CashAcceptanceSession> {
    throwIfAborted(request.signal);
    const lease = await this.dependencies.leases.acquire({
      operationId: request.operationId, logicalService: request.logicalService,
      resourceGroup: request.resourceGroup, authority: "transaction",
    });
    try {
      await this.dependencies.entryGate.assertCanStart(request);
    } catch (error) {
      await lease.release();
      throw error;
    }
    const record: CashAcceptanceRecord = {
      operationId: request.operationId, logicalService: request.logicalService,
      phase: "starting", revision: 0, physicalCommitDispatched: false,
      updatedAt: this.#now(),
    };
    await this.dependencies.store.create(record);
    await evidence(this.dependencies, record, "entry-gate-passed");
    try {
      await this.dependencies.client.cashInStart({
        inputPosition: request.policy.inputPosition, outputPosition: request.policy.outputPosition,
        timeoutMs: request.policy.startTimeoutMs,
      });
      return new ActiveCashAcceptanceSession(this.dependencies, request, record, lease);
    } catch (error) {
      await lease.release();
      throw error;
    }
  }

  #now(): string { return (this.dependencies.now?.() ?? new Date()).toISOString(); }
}

class ActiveCashAcceptanceSession implements CashAcceptanceSession {
  #record: CashAcceptanceRecord;
  #snapshot?: CashAcceptanceSnapshot;
  constructor(
    private readonly dependencies: CashAcceptanceServiceDependencies,
    private readonly request: CashAcceptanceStartRequest,
    record: CashAcceptanceRecord,
    private readonly lease: CashAcceptanceLeaseSession,
  ) { this.#record = record; }

  get operationId(): string { return this.request.operationId; }
  get phase(): CashAcceptancePhase { return this.#record.phase; }

  async acceptBatch(): Promise<CashAcceptanceSnapshot> {
    this.#assert("starting", "accepting", "escrowed");
    throwIfAborted(this.request.signal);
    await this.#phase("accepting", "cash-in-requested");
    const status = await this.dependencies.client.cashIn({ timeoutMs: this.request.policy.acceptTimeoutMs });
    this.#snapshot = createEscrowSnapshot(
      mergeNotes(this.#snapshot?.notes ?? [], status.notes ?? []),
      (this.#snapshot?.refusedCount ?? 0) + (status.refusedCount ?? 0),
      this.#record.revision + 1,
      this.#now(),
    );
    await this.#update({ phase: "escrowed", revision: this.#snapshot.revision, snapshotHash: this.#snapshot.hash });
    await evidence(this.dependencies, this.#record, "escrow-snapshot", {
      revision: this.#snapshot.revision, snapshotHash: this.#snapshot.hash,
      noteCount: this.#snapshot.notes.reduce((sum, note) => sum + note.count, 0),
      refusedCount: this.#snapshot.refusedCount,
    });
    return this.#snapshot;
  }

  async authorize(authorizer: CashAcceptanceAuthorizer): Promise<CashAcceptanceAuthorization> {
    this.#assert("escrowed");
    const snapshot = this.#requireSnapshot();
    await this.#phase("authorizing", "authorization-requested");
    const authorization = await authorizer.authorize(snapshot);
    assertExactAuthorization(this.operationId, snapshot, authorization);
    await this.#update({
      phase: "escrowed", authorizationRevision: authorization.revision,
      authorizationHash: authorization.snapshotHash,
    });
    if (!authorization.approved) throw new CashAcceptanceAuthorizationError("authorization-declined");
    return authorization;
  }

  async commit(authorization: CashAcceptanceAuthorization): Promise<CashAcceptanceResult> {
    this.#assert("escrowed");
    const snapshot = this.#requireSnapshot();
    assertExactAuthorization(this.operationId, snapshot, authorization);
    if (!authorization.approved) throw new CashAcceptanceAuthorizationError("authorization-declined");
    await this.#update({ phase: "committing", physicalCommitDispatched: true });
    await evidence(this.dependencies, this.#record, "physical-commit-dispatched", {
      revision: snapshot.revision, snapshotHash: snapshot.hash,
    });
    await this.dependencies.client.cashInEnd({ timeoutMs: this.request.policy.acceptTimeoutMs });
    await this.#update({ phase: "completed", terminalReason: "committed" });
    await this.lease.release();
    return this.#result("committed", true, "cash-unit");
  }

  async abort(reason: "cancelled" | "timeout"): Promise<CashAcceptanceResult> {
    if (this.#record.physicalCommitDispatched) {
      await this.#update({ phase: "failed", terminalReason: "recovery-required" });
      return this.#result("recovery-required", false, "unknown");
    }
    this.#assert("starting", "accepting", "escrowed", "authorizing");
    await this.#phase("rolling-back", "rollback-requested", { reason });
    await this.dependencies.client.cashInRollback({ timeoutMs: this.request.policy.takeTimeoutMs });
    const taken = await this.dependencies.client.waitForCashTaken({
      timeoutMs: this.request.policy.takeTimeoutMs,
      signal: this.request.signal,
    });
    if (taken) {
      await this.#update({ phase: "failed", terminalReason: "returned" });
      await this.lease.release();
      return this.#result("returned", false, "customer");
    }
    if (this.request.policy.notTakenAction === "intervention") {
      await this.#update({ phase: "failed", terminalReason: reason });
      return this.#result(reason, false, "presented");
    }
    await this.#phase("retracting", "not-taken-retract-requested");
    await this.dependencies.client.retract({
      outputPosition: this.request.policy.outputPosition, retractArea: this.request.policy.retractArea,
      index: this.request.policy.retractIndex, timeoutMs: this.request.policy.retractTimeoutMs,
    });
    await this.#update({ phase: "failed", terminalReason: "retracted" });
    await this.lease.release();
    return this.#result("retracted", false, "retract-unit");
  }

  #requireSnapshot(): CashAcceptanceSnapshot {
    if (!this.#snapshot) throw new Error("No escrow snapshot is available");
    return this.#snapshot;
  }
  #assert(...allowed: readonly CashAcceptancePhase[]): void {
    if (!allowed.includes(this.#record.phase)) throw new Error(`Cash acceptance operation is ${this.#record.phase}`);
  }
  async #phase(phase: CashAcceptancePhase, eventName: string, details?: Readonly<Record<string, unknown>>): Promise<void> {
    await this.#update({ phase });
    await evidence(this.dependencies, this.#record, eventName, details);
  }
  async #update(change: Partial<CashAcceptanceRecord>): Promise<void> {
    this.#record = { ...this.#record, ...change, updatedAt: this.#now() };
    await this.dependencies.store.update(this.#record);
  }
  #result(reason: CashAcceptanceResult["reason"], committed: boolean, custody: "customer" | "cash-unit" | "presented" | "retract-unit" | "unknown"): CashAcceptanceResult {
    const notes = this.#snapshot?.notes ?? [];
    return {
      operationId: this.operationId, phase: this.#record.phase, reason, committed, snapshot: this.#snapshot,
      portions: [{ portionId: "escrow", custody, notes }],
      safeSummary: { operationId: this.operationId, phase: this.#record.phase, reason, committed,
        resourceGroup: this.request.resourceGroup, fencingToken: this.lease.fencingToken,
        snapshotRevision: this.#snapshot?.revision, snapshotHash: this.#snapshot?.hash,
        noteCount: notes.reduce((sum, note) => sum + note.count, 0) },
    };
  }
  #now(): string { return (this.dependencies.now?.() ?? new Date()).toISOString(); }
}

async function evidence(
  dependencies: CashAcceptanceServiceDependencies, record: CashAcceptanceRecord,
  eventName: string, safeDetails?: Readonly<Record<string, unknown>>,
): Promise<void> {
  await dependencies.evidence.append({ operationId: record.operationId, logicalService: record.logicalService,
    phase: record.phase, event: eventName, at: (dependencies.now?.() ?? new Date()).toISOString(), safeDetails });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Operation aborted");
}

function mergeNotes(
  left: readonly { noteId: number; count: number }[],
  right: readonly { noteId: number; count: number }[],
): readonly { noteId: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const note of [...left, ...right]) {
    counts.set(note.noteId, (counts.get(note.noteId) ?? 0) + note.count);
  }
  return [...counts].map(([noteId, count]) => ({ noteId, count }));
}
