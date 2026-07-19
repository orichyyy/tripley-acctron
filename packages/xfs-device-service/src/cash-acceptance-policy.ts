import type { CashAcceptancePolicy, CashAcceptanceSnapshot, CashNoteCount } from "./cash-acceptance-contracts";

export function normalizeCashAcceptancePolicy(policy: Partial<CashAcceptancePolicy>): CashAcceptancePolicy {
  return {
    inputPosition: policy.inputPosition ?? 1,
    outputPosition: policy.outputPosition ?? 1,
    startTimeoutMs: timeout(policy.startTimeoutMs, "startTimeoutMs"),
    acceptTimeoutMs: timeout(policy.acceptTimeoutMs, "acceptTimeoutMs"),
    takeTimeoutMs: timeout(policy.takeTimeoutMs, "takeTimeoutMs"),
    retractTimeoutMs: timeout(policy.retractTimeoutMs, "retractTimeoutMs"),
    notTakenAction: policy.notTakenAction ?? "retract",
    retractArea: policy.retractArea,
    retractIndex: policy.retractIndex,
  };
}

export function createEscrowSnapshot(
  notesInput: readonly CashNoteCount[], refusedCount: number, revision: number, capturedAt: string,
): CashAcceptanceSnapshot {
  const notes = notesInput.filter((note) => note.count > 0)
    .map((note) => ({ noteId: note.noteId, count: note.count }))
    .sort((left, right) => left.noteId - right.noteId);
  const normalizedRefused = Math.max(0, refusedCount);
  const hash = stableHash(JSON.stringify({ revision, notes, refusedCount: normalizedRefused }));
  return { revision, hash, notes, refusedCount: normalizedRefused, capturedAt };
}

export function assertExactAuthorization(
  operationId: string,
  snapshot: CashAcceptanceSnapshot,
  authorization: { operationId: string; revision: number; snapshotHash: string },
): void {
  if (authorization.operationId !== operationId || authorization.revision !== snapshot.revision
    || authorization.snapshotHash !== snapshot.hash) {
    throw new CashAcceptanceAuthorizationError("authorization-stale");
  }
}

export class CashAcceptanceAuthorizationError extends Error {
  constructor(readonly reason: "authorization-stale" | "authorization-declined") {
    super(reason);
    this.name = "CashAcceptanceAuthorizationError";
  }
}

function timeout(value: number | undefined, name: string): number {
  const result = value ?? 30_000;
  if (!Number.isFinite(result) || result <= 0) throw new Error(`${name} must be positive`);
  return result;
}

function stableHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    first = Math.imul(first ^ value.charCodeAt(index), 0x01000193);
    second = Math.imul(second ^ value.charCodeAt(index), 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}
