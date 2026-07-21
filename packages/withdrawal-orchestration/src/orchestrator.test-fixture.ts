import {
  InMemoryOperationFinalizationStore,
  OperationFinalizationRunner,
  OperationFinalizerRegistry,
} from "@tripley-kit/web-container-kiosk-runtime";
import type {
  CardCustodyResult,
  CashDeliveryTerminalResult,
  CashDispensePlan,
  CashInventorySnapshot,
} from "@tripley-kit/web-container-xfs-device-service";
import { vi } from "vitest";

import type {
  WithdrawalHostProtocolMode,
  WithdrawalPrePresentGateResult,
  WithdrawalRequest,
} from "./contracts";
import { registerWithdrawalLocalFinalizers, createHostFinancialCompletionFinalizer } from "./finalizers";
import { WithdrawalOrchestrator } from "./orchestrator";
import { WithdrawalPolicyRegistry, WithdrawalPrePresentGateRegistry } from "./policy";

export interface FixtureOptions {
  readonly cardAvailable?: boolean;
  readonly cardOrder?: "return-before-cash-present" | "return-after-cash-terminal";
  readonly cardResult?: CardCustodyResult;
  readonly cashTerminal?: CashDeliveryTerminalResult;
  readonly completion?: boolean;
  readonly entryMode?: "contact-card" | "cardless-reservation";
  readonly gateResult?: WithdrawalPrePresentGateResult;
  readonly protocolMode?: WithdrawalHostProtocolMode;
  readonly recoveryStatus?: "ready" | "recovering" | "intervention";
}

export const createFixture = (options: FixtureOptions = {}) => {
  const events: string[] = [];
  const transactions = {
    finish: vi.fn(async () => { events.push("transaction.finalize"); }),
    markAuthorized: vi.fn(async () => { events.push("transaction.authorized"); }),
    start: vi.fn(async () => { events.push("transaction.start"); }),
  };
  const audit = {
    append: vi.fn(async (event: { eventId: string }) => { events.push(`audit.${event.eventId}`); }),
  };
  const scopedState = {
    reset: vi.fn(async () => { events.push("scope.reset"); }),
  };
  const host = {
    authorize: vi.fn(async () => {
      events.push("host.authorize");
      return { authorizationReference: "host-auth-1", status: "approved" as const };
    }),
    complete: vi.fn(async () => { events.push("host.complete"); }),
  };
  const cashTerminal = options.cashTerminal ?? terminal("taken", "after-1");
  const session = {
    id: "cash-session-1",
    phase: "planned" as const,
    isTerminal: false,
    abort: vi.fn(async () => {
      events.push("cash.abort");
      session.isTerminal = true;
      return terminal("retracted", "after-abort");
    }),
    dispense: vi.fn(async () => { events.push("cash.dispense"); }),
    exit: vi.fn(async () => {
      events.push("cash.exit");
      return {
        receipt: { fencingToken: 1, leaseId: "recovery-1", state: "recoveryBound" as const },
        status: "transferred" as const,
      };
    }),
    present: vi.fn(async () => { events.push("cash.present"); }),
    waitForTake: vi.fn(async () => {
      events.push("cash.waitForTake");
      session.isTerminal = true;
      return cashTerminal;
    }),
  };
  const cash = {
    start: vi.fn(async () => {
      events.push("cash.start");
      return { before: snapshot("before-1", "before"), plan: plan(), session };
    }),
  };
  const cardResult = options.cardResult ?? returnedCard();
  const card = {
    returnCard: vi.fn(async () => { events.push("card.return"); return cardResult; }),
  };
  const presentationAuthorizer = {
    authorize: vi.fn(async (input: { operationId: string; cashSessionId: string }) => {
      events.push("cash.authorizePresent");
      return {
        cashSessionId: input.cashSessionId,
        expiresAt: Date.now() + 10_000,
        id: "present-auth-1",
        operationId: input.operationId,
        policyId: "cash.present.standard",
        policyVersion: "1",
        satisfiedGates: [],
      };
    }),
  };
  const gates = new WithdrawalPrePresentGateRegistry();
  if (options.gateResult) {
    gates.register({
      evaluate: async () => { events.push("gate.otp"); return options.gateResult!; },
      id: "mobile-otp",
    });
  }
  const entryMode = options.entryMode ?? "cardless-reservation";
  const policies = new WithdrawalPolicyRegistry().register({
    allowedEntryModes: [entryMode],
    cardCustodyPolicyId: entryMode === "contact-card" ? "card.standard" : undefined,
    cardOrder: options.cardOrder ?? "return-before-cash-present",
    hostProtocol: {
      id: "host.standard",
      mode: options.protocolMode ?? "authorization-only",
      version: "1",
    },
    id: "withdrawal.standard",
    prePresentGateIds: options.gateResult ? ["mobile-otp"] : [],
    presentationPolicy: {
      authorizationTtlMs: 10_000,
      id: "cash.present.standard",
      requiredGates: [],
      takeTimeoutMs: 1_000,
      version: "1",
    },
    version: "1",
  });
  const finalizers = registerWithdrawalLocalFinalizers(
    new OperationFinalizerRegistry(),
    { audit, scopedState, transactions },
  );
  if (options.completion) finalizers.register(createHostFinancialCompletionFinalizer(host));
  const orchestrator = new WithdrawalOrchestrator({
    audit,
    ...(options.cardAvailable === false ? {} : { card }),
    cash,
    finalization: new OperationFinalizationRunner(
      finalizers,
      new InMemoryOperationFinalizationStore(),
    ),
    host,
    policies,
    prePresentGates: gates,
    presentationAuthorizer,
    recoveryBarrier: {
      recover: async () => ({ safeSummary: {}, status: options.recoveryStatus ?? "ready" }),
    },
    transactions,
  });
  const request: WithdrawalRequest = {
    amount: { currency: "USD", minorUnits: 10_000 },
    entryMode,
    operationId: "withdrawal-1",
    ownerInstanceId: "kiosk-1",
    policyId: "withdrawal.standard",
  };
  return {
    audit,
    card,
    cash,
    events,
    host,
    orchestrator,
    presentationAuthorizer,
    request,
    scopedState,
    session,
    transactions,
  };
};

export const terminal = (
  outcome: CashDeliveryTerminalResult["outcome"],
  afterId: string,
): CashDeliveryTerminalResult => ({
  after: snapshot(afterId, "after"),
  outcome,
  reconciliationRequired: outcome === "custodyUnknown",
  safeSummary: { outcome },
});

export const retainedCard = (): CardCustodyResult => ({
  authorityReleased: true,
  logicalService: "IDC1",
  mediaState: "notPresent",
  operationId: "withdrawal-1",
  reason: "take-timeout",
  safeSummary: { status: "retained" },
  status: "retained",
});

const returnedCard = (): CardCustodyResult => ({
  authorityReleased: true,
  logicalService: "IDC1",
  mediaState: "notPresent",
  operationId: "withdrawal-1",
  reason: "taken",
  safeSummary: { status: "returned" },
  status: "returned",
});

const snapshot = (
  id: string,
  boundary: CashInventorySnapshot["boundary"],
): CashInventorySnapshot => ({
  boundary,
  capturedAt: "2026-07-21T00:00:00.000Z",
  cashSessionId: "cash-session-1",
  certainty: "observed",
  id,
  logicalService: "CDM1",
  operationId: "withdrawal-1",
  revision: "revision-1",
  source: "device",
  units: [],
});

const plan = (): CashDispensePlan => ({
  cashSessionId: "cash-session-1",
  cashUnitRevision: "revision-1",
  denomination: {
    amount: 10_000,
    cashBox: 0,
    currencyId: "USD",
    values: new Uint8Array(),
  },
  expiresAt: Date.now() + 10_000,
  id: "plan-1",
  logicalService: "CDM1",
  operationId: "withdrawal-1",
  policyVersion: "1",
  sessionGeneration: 1,
});
