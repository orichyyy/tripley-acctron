import type {
  CardCustodyResult,
  CashDeliveryTerminalResult,
} from "@tripley-kit/web-container-xfs-device-service";

import type {
  WithdrawalCardFacts,
  WithdrawalCashFacts,
  WithdrawalCashSessionPort,
  WithdrawalCashDeliveryPort,
  WithdrawalExecutionResult,
  WithdrawalHostAuthorizationResult,
  WithdrawalHostFacts,
  WithdrawalOrchestratorOptions,
  WithdrawalOutcome,
  WithdrawalPolicy,
  WithdrawalPrePresentGateResult,
  WithdrawalReason,
  WithdrawalRequest,
  WithdrawalStatus,
  WithdrawalTrigger,
} from "./contracts";

interface OperationState {
  host: WithdrawalHostFacts;
  cash: WithdrawalCashFacts;
  card: WithdrawalCardFacts;
}

export class WithdrawalOrchestrator {
  public constructor(private readonly options: WithdrawalOrchestratorOptions) {}

  public async execute(request: WithdrawalRequest): Promise<WithdrawalExecutionResult> {
    const policy = this.options.policies.require(request.policyId);
    assertRequestAllowed(request, policy);
    const state = initialState(request, policy);
    const admission = await this.options.recoveryBarrier?.recover();
    if (admission && admission.status !== "ready") {
      return { outcome: buildOutcome(request, policy, state, "intervention", "recovery-barrier-blocked") };
    }

    await this.options.transactions.start(request, policy);
    await this.options.audit.append({
      data: { entryMode: request.entryMode, policyId: policy.id },
      eventId: "withdrawal.started",
      message: "Withdrawal orchestration started",
      operationId: request.operationId,
    });

    const outcome = await this.runAdmitted(request, policy, state);
    const finalization = await this.options.finalization.run({
      metadata: { entryMode: request.entryMode, policyId: policy.id, policyVersion: policy.version },
      operationId: request.operationId,
      result: outcome,
    });
    return { finalization, outcome };
  }

  private async runAdmitted(
    request: WithdrawalRequest,
    policy: WithdrawalPolicy,
    state: OperationState,
  ): Promise<WithdrawalOutcome> {
    let session: WithdrawalCashSessionPort | undefined;
    try {
      if (request.signal?.aborted) {
        await this.resolveCard(request, policy, state, false);
        const interrupt = requestInterrupt(request);
        return safeOutcome(request, policy, state, interrupt.status, interrupt.reason, interrupt.trigger);
      }

      let started: Awaited<ReturnType<WithdrawalCashDeliveryPort["start"]>> | undefined;
      if (planningBeforeAuthorization(policy)) {
        started = await this.startCash(request, policy, state);
        if (!started) {
          await this.resolveCard(request, policy, state, false);
          return safeOutcome(request, policy, state, "failed", "cash-start-failed");
        }
        session = started.session;
      }

      const authorization = await this.authorizeHost(
        request,
        policy,
        state,
        started?.plan,
      );
      if (!authorization) {
        if (session) await this.abortCash(session, state, "interrupt");
        await this.resolveCard(request, policy, state, false);
        const status = state.host.status === "declined" ? "declined" : "failed";
        const reason = state.host.status === "declined" ? "host-declined" : "host-unavailable";
        return safeOutcome(request, policy, state, status, reason);
      }

      await this.options.transactions.markAuthorized(request.operationId, authorization);
      await this.options.audit.append({
        data: { hostStatus: "approved", protocolId: policy.hostProtocol.id },
        eventId: "withdrawal.authorized",
        message: "Withdrawal host authorization approved",
        operationId: request.operationId,
      });

      if (!started) {
        started = await this.startCash(request, policy, state);
        if (!started) {
          await this.resolveCard(request, policy, state, false);
          return safeOutcome(request, policy, state, "failed", "cash-start-failed");
        }
        session = started.session;
      }
      const activeSession = started.session;
      session = activeSession;

      try {
        await activeSession.dispense(started.plan);
        state.cash = { ...state.cash, dispense: "completed", dispensed: true };
      } catch {
        state.cash = { ...state.cash, dispense: "execution-unknown", reconciliationRequired: true };
        await this.transferCash(activeSession, state, "interrupt");
        await this.resolveCard(request, policy, state, false);
        return safeOutcome(request, policy, state, "intervention", "cash-dispense-failed", "interrupt");
      }

      const gate = await this.options.prePresentGates.evaluate(policy.prePresentGateIds, {
        amount: request.amount,
        cashSessionId: activeSession.id,
        entryMode: request.entryMode,
        operationId: request.operationId,
        ...(request.signal ? { signal: request.signal } : {}),
      });
      if (gate.status !== "approved") {
        const failure = gateFailure(gate);
        await this.abortCash(activeSession, state, failure.trigger);
        await this.resolveCard(request, policy, state, false);
        return safeOutcome(request, policy, state, failure.status, failure.reason, failure.trigger);
      }

      if (policy.cardOrder === "return-before-cash-present") {
        const card = await this.resolveCard(request, policy, state, true);
        if (state.card.required && state.card.status !== "returned") {
          const trigger = card ? cardTrigger(card) : "interrupt";
          await this.abortCash(activeSession, state, trigger);
          const failure = card
            ? cardFailure(card)
            : { reason: "card-custody-unresolved" as const, status: "intervention" as const };
          return safeOutcome(request, policy, state, failure.status, failure.reason, failure.trigger);
        }
      }

      let presentation;
      try {
        presentation = await this.options.presentationAuthorizer.authorize({
          cashSessionId: activeSession.id,
          operationId: request.operationId,
          policy: policy.presentationPolicy,
        });
      } catch {
        await this.abortCash(activeSession, state, "interrupt");
        await this.resolveCard(request, policy, state, false);
        return safeOutcome(request, policy, state, "failed", "cash-presentation-not-authorized");
      }

      try {
        await activeSession.present(presentation);
        state.cash = { ...state.cash, present: "completed", presented: true };
      } catch {
        state.cash = { ...state.cash, present: "execution-unknown", reconciliationRequired: true };
        await this.transferCash(activeSession, state, "interrupt");
        await this.resolveCard(request, policy, state, false);
        return safeOutcome(request, policy, state, "intervention", "cash-present-failed", "interrupt");
      }

      const terminal = await activeSession.waitForTake();
      applyCashTerminal(state, terminal);
      if (policy.cardOrder === "return-after-cash-terminal") {
        await this.resolveCard(request, policy, state, true);
      }
      return terminalOutcome(request, policy, state);
    } catch {
      if (session && !session.isTerminal) await this.transferCash(session, state, "interrupt");
      await this.resolveCard(request, policy, state, false);
      return safeOutcome(request, policy, state, "intervention", "unexpected-failure", "interrupt");
    }
  }

  private async authorizeHost(
    request: WithdrawalRequest,
    policy: WithdrawalPolicy,
    state: OperationState,
    cashPlan?: Parameters<WithdrawalCashSessionPort["dispense"]>[0],
  ): Promise<WithdrawalHostAuthorizationResult | undefined> {
    try {
      const result = await this.options.host.authorize({
        amount: request.amount,
        entryMode: request.entryMode,
        operationId: request.operationId,
        protocol: policy.hostProtocol,
        ...(cashPlan ? { cashPlan } : {}),
        ...(request.safeMetadata ? { safeMetadata: request.safeMetadata } : {}),
      });
      state.host = {
        ...state.host,
        status: result.status,
        ...(result.authorizationReference
          ? { authorizationReference: result.authorizationReference }
          : {}),
        ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
      };
      return result.status === "approved" ? result : undefined;
    } catch {
      state.host = { ...state.host, status: "unavailable" };
      return undefined;
    }
  }

  private async startCash(
    request: WithdrawalRequest,
    policy: WithdrawalPolicy,
    state: OperationState,
  ): Promise<Awaited<ReturnType<WithdrawalCashDeliveryPort["start"]>> | undefined> {
    try {
      const started = await this.options.cash.start({
        amount: request.amount,
        operationId: request.operationId,
        ownerInstanceId: request.ownerInstanceId,
        presentationPolicy: policy.presentationPolicy,
      });
      state.cash = {
        ...state.cash,
        beforeSnapshotId: started.before.id,
        cashSessionId: started.session.id,
        custody: "pending",
      };
      return started;
    } catch {
      return undefined;
    }
  }

  private async resolveCard(
    request: WithdrawalRequest,
    policy: WithdrawalPolicy,
    state: OperationState,
    respectSignal: boolean,
  ): Promise<CardCustodyResult | undefined> {
    if (policy.cardOrder === "managed-by-parent-session") return undefined;
    if (request.entryMode !== "contact-card" || state.card.status !== "pending") return undefined;
    if (!this.options.card || !policy.cardCustodyPolicyId) {
      state.card = { required: true, status: "intervention", reason: "custody-unknown" };
      return undefined;
    }
    const result = await this.options.card.returnCard({
      operationId: request.operationId,
      policyId: policy.cardCustodyPolicyId,
      ...(request.cardAuthority ? { authority: request.cardAuthority } : {}),
      ...(respectSignal && request.signal ? { signal: request.signal } : {}),
      ...(respectSignal && request.interruptReason ? { interruptReason: request.interruptReason } : {}),
    });
    state.card = {
      authorityReleased: result.authorityReleased,
      mediaState: result.mediaState,
      reason: result.reason,
      required: true,
      status: result.status,
    };
    return result;
  }

  private async abortCash(
    session: WithdrawalCashSessionPort,
    state: OperationState,
    trigger: WithdrawalTrigger,
  ): Promise<void> {
    try {
      applyCashTerminal(state, await session.abort(trigger));
    } catch {
      state.cash = { ...state.cash, custody: "custodyUnknown", reconciliationRequired: true };
    }
  }

  private async transferCash(
    session: WithdrawalCashSessionPort,
    state: OperationState,
    trigger: WithdrawalTrigger,
  ): Promise<void> {
    try {
      const exit = await session.exit(trigger);
      if (exit.status === "terminal") {
        applyCashTerminal(state, exit.result);
      } else {
        state.cash = {
          ...state.cash,
          custody: "recovery-transferred",
          recoveryTransferId: exit.receipt.leaseId,
          reconciliationRequired: true,
        };
      }
    } catch {
      state.cash = { ...state.cash, custody: "custodyUnknown", reconciliationRequired: true };
    }
  }
}

const initialState = (request: WithdrawalRequest, policy: WithdrawalPolicy): OperationState => ({
  host: {
    protocolId: policy.hostProtocol.id,
    protocolMode: policy.hostProtocol.mode,
    protocolVersion: policy.hostProtocol.version,
    status: "not-requested",
  },
  cash: {
    custody: "not-started",
    dispense: "not-requested",
    dispensed: false,
    present: "not-requested",
    presented: false,
    reconciliationRequired: false,
    retracted: false,
    taken: false,
  },
  card: {
    required: request.entryMode === "contact-card",
    status: request.entryMode !== "contact-card"
      ? "not-applicable"
      : policy.cardOrder === "managed-by-parent-session"
        ? "session-retained"
        : "pending",
  },
});

const applyCashTerminal = (state: OperationState, result: CashDeliveryTerminalResult): void => {
  state.cash = {
    ...state.cash,
    custody: result.outcome,
    ...(result.after ? { afterSnapshotId: result.after.id } : {}),
    reconciliationRequired: result.reconciliationRequired,
    retracted: result.outcome === "retracted",
    taken: result.outcome === "taken",
  };
};

const terminalOutcome = (
  request: WithdrawalRequest,
  policy: WithdrawalPolicy,
  state: OperationState,
): WithdrawalOutcome => {
  if (state.cash.custody === "retracted") {
    return safeOutcome(request, policy, state, "timedOut", "cash-take-timeout", "timeout");
  }
  if (state.cash.custody !== "taken") {
    return safeOutcome(request, policy, state, "intervention", "cash-custody-unknown");
  }
  if (
    state.card.required &&
    state.card.status !== "returned" &&
    state.card.status !== "session-retained"
  ) {
    const reason = state.card.reason === "take-timeout" ? "card-take-timeout" : "card-custody-unresolved";
    return safeOutcome(request, policy, state, "intervention", reason);
  }
  return safeOutcome(request, policy, state, "completed", "completed");
};

const safeOutcome = (
  request: WithdrawalRequest,
  policy: WithdrawalPolicy,
  state: OperationState,
  requestedStatus: WithdrawalStatus,
  reason: WithdrawalReason,
  trigger?: WithdrawalTrigger,
): WithdrawalOutcome => {
  const status = safetyStatus(requestedStatus, state);
  return buildOutcome(request, policy, state, status, reason, trigger);
};

const buildOutcome = (
  request: WithdrawalRequest,
  policy: WithdrawalPolicy,
  state: OperationState,
  status: WithdrawalStatus,
  reason: WithdrawalReason,
  trigger?: WithdrawalTrigger,
): WithdrawalOutcome => Object.freeze({
  card: Object.freeze({ ...state.card }),
  cash: Object.freeze({ ...state.cash }),
  entryMode: request.entryMode,
  host: Object.freeze({ ...state.host }),
  kind: "withdrawal.outcome" as const,
  operationId: request.operationId,
  policyId: policy.id,
  policyVersion: policy.version,
  reason,
  safeSummary: Object.freeze({
    cardStatus: state.card.status,
    cashCustody: state.cash.custody,
    cashDispensed: state.cash.dispensed,
    cashPresented: state.cash.presented,
    cashRetracted: state.cash.retracted,
    cashTaken: state.cash.taken,
    entryMode: request.entryMode,
    hostStatus: state.host.status,
    operationId: request.operationId,
    policyId: policy.id,
    reason,
    status,
    ...(trigger ? { trigger } : {}),
  }),
  status,
  ...(trigger ? { trigger } : {}),
});

const safetyStatus = (requested: WithdrawalStatus, state: OperationState): WithdrawalStatus => {
  if (state.cash.custody === "custodyUnknown" || state.cash.custody === "recovery-transferred") {
    return "intervention";
  }
  if (state.card.required && ["pending", "inside", "presented", "intervention"].includes(state.card.status)) {
    return "intervention";
  }
  return requested;
};

const gateFailure = (result: WithdrawalPrePresentGateResult): {
  status: WithdrawalStatus;
  reason: WithdrawalReason;
  trigger: WithdrawalTrigger;
} => {
  if (result.status === "cancelled") {
    return { reason: "verification-cancelled", status: "cancelled", trigger: "cancel" };
  }
  if (result.status === "timedOut") {
    return { reason: "verification-timeout", status: "timedOut", trigger: "timeout" };
  }
  return { reason: "verification-rejected", status: "failed", trigger: "interrupt" };
};

const cardFailure = (result: CardCustodyResult): {
  status: WithdrawalStatus;
  reason: WithdrawalReason;
  trigger?: WithdrawalTrigger;
} => {
  if (result.reason === "take-timeout" || result.reason === "operation-timeout") {
    return { reason: "card-take-timeout", status: "timedOut", trigger: "timeout" };
  }
  if (result.reason === "user-cancelled") {
    return { reason: "card-cancelled", status: "cancelled", trigger: "cancel" };
  }
  return { reason: "card-custody-unresolved", status: "intervention" };
};

const cardTrigger = (result: CardCustodyResult): WithdrawalTrigger => {
  if (result.reason === "take-timeout" || result.reason === "operation-timeout") return "timeout";
  if (result.reason === "user-cancelled") return "cancel";
  return "interrupt";
};

const requestInterrupt = (request: WithdrawalRequest): {
  status: WithdrawalStatus;
  reason: WithdrawalReason;
  trigger: WithdrawalTrigger;
} => request.interruptReason === "operation-timeout"
  ? { reason: "operation-timeout", status: "timedOut", trigger: "timeout" }
  : { reason: "user-cancelled", status: "cancelled", trigger: "cancel" };

const assertRequestAllowed = (request: WithdrawalRequest, policy: WithdrawalPolicy): void => {
  if (!policy.allowedEntryModes.includes(request.entryMode)) {
    throw new Error(`Withdrawal entry mode is not allowed by policy: ${request.entryMode}`);
  }
  if (!request.operationId.trim() || !request.ownerInstanceId.trim()) {
    throw new Error("Withdrawal operation and owner identity are required");
  }
};

const planningBeforeAuthorization = (policy: WithdrawalPolicy): boolean =>
  policy.cashPlanningOrder === "cash-planning-before-authorization";
