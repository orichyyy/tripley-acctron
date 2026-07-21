import {
  InMemoryOperationFinalizationStore,
  OperationFinalizationRunner,
  OperationFinalizerRegistry,
} from "@tripley-kit/web-container-kiosk-runtime";
import type {
  CashAcceptanceAuthorization,
  CashAcceptanceAuthorizer,
  CashAcceptanceResult,
  CashAcceptanceSnapshot,
} from "@tripley-kit/web-container-xfs-device-service";
import { vi } from "vitest";

import type {
  DepositEscrowReviewResult,
  DepositHostProtocolMode,
  DepositRequest,
  DepositReturnedMediaResolution,
} from "./contracts";
import {
  createDepositHostFinancialCompletionFinalizer,
  registerDepositLocalFinalizers,
} from "./finalizers";
import { DepositOrchestrator } from "./orchestrator";
import { DepositEscrowReviewGateRegistry, DepositPolicyRegistry } from "./policy";

export interface FixtureOptions {
  readonly abortResult?: CashAcceptanceResult;
  readonly commitError?: boolean;
  readonly completion?: boolean;
  readonly hostApproved?: boolean;
  readonly inventoryAfterError?: boolean;
  readonly protocolMode?: DepositHostProtocolMode;
  readonly recoveryStatus?: "ready" | "recovering" | "intervention";
  readonly refusedResolution?: DepositReturnedMediaResolution;
  readonly reviewResults?: readonly DepositEscrowReviewResult[];
  readonly snapshots?: readonly CashAcceptanceSnapshot[];
}

export const createFixture = (options: FixtureOptions = {}) => {
  const events: string[] = [];
  const snapshots = [...(options.snapshots ?? [snapshot(1, 0)])];
  const reviewResults = [...(options.reviewResults ?? [{ decision: "confirm" as const }])];
  let currentSnapshot = snapshots[0]!;
  const transactions = {
    finish: vi.fn(async () => { events.push("transaction.finalize"); }),
    markAuthorized: vi.fn(async () => { events.push("transaction.authorized"); }),
    markEscrow: vi.fn(async () => { events.push("transaction.escrow"); }),
    start: vi.fn(async () => { events.push("transaction.start"); }),
  };
  const audit = {
    append: vi.fn(async (event: { eventId: string }) => { events.push(`audit.${event.eventId}`); }),
  };
  const scopedState = {
    reset: vi.fn(async () => { events.push("scope.reset"); }),
  };
  const host = {
    authorize: vi.fn(async (input: { operationId: string; snapshot: CashAcceptanceSnapshot }) => {
      events.push("host.authorize");
      return {
        approved: options.hostApproved ?? true,
        authorizationReference: "host-auth-1",
        operationId: input.operationId,
        revision: input.snapshot.revision,
        snapshotHash: input.snapshot.hash,
      };
    }),
    complete: vi.fn(async () => { events.push("host.complete"); }),
  };
  const session = {
    operationId: "deposit-1",
    phase: "starting" as const,
    abort: vi.fn(async () => {
      events.push("cash.abort");
      return options.abortResult ?? returnedResult("customer");
    }),
    acceptBatch: vi.fn(async () => {
      events.push("cash.acceptBatch");
      currentSnapshot = snapshots.shift() ?? currentSnapshot;
      return currentSnapshot;
    }),
    authorize: vi.fn(async (authorizer: CashAcceptanceAuthorizer) => {
      events.push("cash.authorize");
      const result = await authorizer.authorize(currentSnapshot);
      if (!result.approved) throw new Error("authorization-declined");
      return result;
    }),
    commit: vi.fn(async (_authorization: CashAcceptanceAuthorization) => {
      events.push("cash.commit");
      if (options.commitError) throw new Error("commit-unknown");
      return committedResult(currentSnapshot);
    }),
  };
  const cash = {
    start: vi.fn(async () => { events.push("cash.start"); return session; }),
  };
  const inventory = {
    capture: vi.fn(async (input: { boundary: "before" | "after" }) => {
      events.push(`inventory.${input.boundary}`);
      if (input.boundary === "after" && options.inventoryAfterError) throw new Error("inventory unavailable");
      return {
        boundary: input.boundary,
        capturedAt: "2026-07-21T00:00:00.000Z",
        id: `inventory-${input.boundary}`,
        logicalService: "CIM1",
        operationId: "deposit-1",
        revision: `revision-${input.boundary}`,
        safeSummary: { boundary: input.boundary },
      };
    }),
  };
  const returnedMedia = {
    resolveRefused: vi.fn(async () => {
      events.push("refused.resolve");
      return options.refusedResolution ?? { status: "taken" as const };
    }),
  };
  const reviewGates = new DepositEscrowReviewGateRegistry().register({
    evaluate: async () => {
      events.push("review.evaluate");
      return reviewResults.shift() ?? { decision: "confirm" as const };
    },
    id: "deposit.review.standard",
  });
  const policies = new DepositPolicyRegistry().register({
    acceptancePolicy: {
      acceptTimeoutMs: 1_000,
      inputPosition: 1,
      notTakenAction: "retract",
      outputPosition: 1,
      retractTimeoutMs: 1_000,
      startTimeoutMs: 1_000,
      takeTimeoutMs: 1_000,
    },
    hostProtocol: {
      id: "host.deposit.standard",
      mode: options.protocolMode ?? "authorization-only",
      version: "1",
    },
    id: "deposit.standard",
    logicalService: "CIM1",
    maxBatches: 3,
    resourceGroup: "cash-transport-1",
    reviewGateId: "deposit.review.standard",
    version: "1",
  });
  const finalizers = registerDepositLocalFinalizers(
    new OperationFinalizerRegistry(),
    { audit, scopedState, transactions },
  );
  if (options.completion) {
    finalizers.register(createDepositHostFinancialCompletionFinalizer(host));
  }
  const orchestrator = new DepositOrchestrator({
    audit,
    cash,
    finalization: new OperationFinalizationRunner(
      finalizers,
      new InMemoryOperationFinalizationStore(),
    ),
    host,
    inventory,
    policies,
    recoveryBarrier: {
      recover: async () => ({ safeSummary: {}, status: options.recoveryStatus ?? "ready" }),
    },
    returnedMedia,
    reviewGates,
    transactions,
  });
  const request: DepositRequest = { operationId: "deposit-1", policyId: "deposit.standard" };
  return {
    cash,
    events,
    host,
    inventory,
    orchestrator,
    request,
    returnedMedia,
    session,
    transactions,
  };
};

export const snapshot = (
  revision: number,
  refusedCount: number,
): CashAcceptanceSnapshot => ({
  capturedAt: "2026-07-21T00:00:00.000Z",
  hash: `snapshot-${revision}`,
  notes: [{ count: revision, noteId: 1 }],
  refusedCount,
  revision,
});

export const returnedResult = (
  custody: "customer" | "retract-unit" | "presented" | "unknown",
): CashAcceptanceResult => ({
  committed: false,
  operationId: "deposit-1",
  phase: "failed",
  portions: [{ custody, notes: [{ count: 1, noteId: 1 }], portionId: "escrow" }],
  reason: custody === "customer" ? "returned" : custody === "retract-unit" ? "retracted" : "cancelled",
  safeSummary: { custody },
  snapshot: snapshot(1, 0),
});

const committedResult = (escrow: CashAcceptanceSnapshot): CashAcceptanceResult => ({
  committed: true,
  operationId: "deposit-1",
  phase: "completed",
  portions: [{ custody: "cash-unit", notes: escrow.notes, portionId: "escrow" }],
  reason: "committed",
  safeSummary: { committed: true },
  snapshot: escrow,
});
