import { FrameworkError } from "@tripley-kit/web-container-errors";
import type { JsonValue } from "@tripley-kit/web-container-types";

import type { LocalAuthenticationPlanPolicy } from "./authentication";
import type { AuthenticationChallengeRegistry, EntryMethodRegistry } from "./registries";
import type {
  AuthenticationChallengeContext,
  CapabilitySnapshot,
  CustomerOperationResult,
  EntryMethodContribution,
  KioskRuntimeOptions,
  MediaCustodyResolution,
  OperationExecutionContext,
  OperationViewPatch,
  OperationViewState,
  StartCustomerOperationInput,
} from "./types";

export class CustomerOperationCoordinator {
  private active:
    | {
        readonly intentId: string;
        readonly operationId: string;
        readonly abort: AbortController;
        readonly promise: Promise<CustomerOperationResult>;
        readonly requiredCapabilities: Set<string>;
      }
    | undefined;
  private attempts = new Map<string, number>();
  private intervention = false;
  private state: OperationViewState = { mediaCustody: "none", phase: "idle", revision: 0 };
  private readonly listeners = new Set<(state: OperationViewState) => void>();

  public constructor(
    private readonly options: KioskRuntimeOptions,
    private readonly entries: EntryMethodRegistry,
    private readonly challenges: AuthenticationChallengeRegistry,
    private readonly authenticationPolicy: LocalAuthenticationPlanPolicy,
    private readonly capabilities: CapabilitySnapshot,
  ) {}

  public snapshot(): OperationViewState {
    return this.state;
  }

  public isActive(): boolean {
    return this.active !== undefined;
  }

  public isIntervention(): boolean {
    return this.intervention;
  }

  public subscribe(listener: (state: OperationViewState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  public start(input: StartCustomerOperationInput): Promise<CustomerOperationResult> {
    if (this.intervention) {
      throw operationError(
        "operation.intervention",
        "Terminal intervention blocks new operations.",
      );
    }
    if (this.active) {
      if (this.active.intentId === input.intentId) {
        return this.active.promise;
      }
      throw operationError("operation.alreadyActive", "A customer operation is already active.");
    }
    const entry = this.entries.require(input.entryMethodId);
    const operationId = this.options.operationIdFactory?.() ?? `operation-${Date.now()}`;
    const abort = new AbortController();
    const promise = this.run(entry, input, operationId, abort);
    this.active = {
      abort,
      intentId: input.intentId,
      operationId,
      promise,
      requiredCapabilities: new Set(entry.requiredCapabilities ?? []),
    };
    return promise;
  }

  public async interrupt(reasonCode = "operation.interrupted"): Promise<void> {
    if (!this.active) {
      return;
    }
    this.active.abort.abort(reasonCode);
    await this.active.promise.catch(() => undefined);
  }

  public async interruptUnavailableCapabilities(): Promise<boolean> {
    const active = this.active;
    if (!active) {
      return false;
    }
    const unavailable = [...active.requiredCapabilities].find(
      (capabilityId) => this.capabilities.status(capabilityId) === "unavailable",
    );
    if (!unavailable) {
      return false;
    }
    active.abort.abort(`capability.${unavailable}.unavailable`);
    await active.promise.catch(() => undefined);
    return true;
  }

  public async recover(): Promise<void> {
    const records = await this.options.ports.ledger.listActive();
    if (records.length === 0) {
      return;
    }
    this.setView({ phase: "recovering" });
    for (const record of records) {
      const entry = record.entryMethodId ? this.entries.get(record.entryMethodId) : undefined;
      const custody = record.mediaCustody ?? "none";
      this.setView({
        entryMethodId: record.entryMethodId,
        mediaCustody: custody,
        operationId: record.operationId,
        phase: "recovering",
      });
      if (custody === "none" || custody === "returned" || custody === "retained") {
        await this.options.ports.ledger.update(record.idempotencyKey, { status: "abandoned" });
        if (record.operationId) {
          await this.audit("operation.recovery.abandoned", record.operationId, {
            entryMethodId: record.entryMethodId ?? null,
            mediaCustody: custody,
          });
        }
        continue;
      }
      if (!entry?.mediaCustody.reconcile || !record.operationId) {
        await this.markIntervention(record.idempotencyKey, "custody.reconciliation.unavailable");
        if (record.operationId) {
          await this.audit("operation.recovery.intervention", record.operationId, {
            entryMethodId: record.entryMethodId ?? null,
            reasonCode: "custody.reconciliation.unavailable",
          });
        }
        continue;
      }
      const resolution = await entry.mediaCustody.reconcile({
        entryMethodId: entry.id,
        operationId: record.operationId,
        recordedStatus: custody,
        signal: new AbortController().signal,
      });
      if (resolution.status === "unknown") {
        await this.markIntervention(record.idempotencyKey, resolution.reasonCode);
        await this.audit("operation.recovery.intervention", record.operationId, {
          entryMethodId: entry.id,
          reasonCode: resolution.reasonCode ?? "custody.unknown",
        });
      } else {
        await this.options.ports.ledger.update(record.idempotencyKey, {
          mediaCustody: resolution.status,
          status: "abandoned",
        });
        await this.audit("operation.recovery.reconciled", record.operationId, {
          entryMethodId: entry.id,
          mediaCustody: resolution.status,
        });
      }
    }
    this.setView(
      this.intervention
        ? { phase: "intervention" }
        : {
            entryMethodId: undefined,
            mediaCustody: "none",
            operationId: undefined,
            phase: "idle",
          },
    );
  }

  private async run(
    entry: EntryMethodContribution,
    input: StartCustomerOperationInput,
    operationId: string,
    abort: AbortController,
  ): Promise<CustomerOperationResult> {
    const idempotencyKey = `withdrawal:${input.intentId}`;
    const deadlineAt =
      (this.options.now?.() ?? Date.now()) + this.options.policy.operationDeadlineMs;
    const deadline = setTimeout(
      () => abort.abort("operation.deadlineExceeded"),
      this.options.policy.operationDeadlineMs,
    );
    const compensationAbort = new AbortController();
    this.attempts = new Map();
    const ctx = this.context(
      entry.id,
      operationId,
      deadlineAt,
      abort.signal,
      compensationAbort.signal,
      idempotencyKey,
    );
    let outcome: "completed" | "failed" | "interrupted" = "failed";
    let safeOutput: JsonValue | undefined;

    await this.options.ports.ledger.start("withdrawal", idempotencyKey, {
      entryMethodId: entry.id,
      mediaCustody: "none",
      operationId,
      phase: "waitingCredential",
    });
    this.setView({
      entryMethodId: entry.id,
      feedback: undefined,
      mediaCustody: "none",
      operationId,
      phase: "waitingCredential",
      promptId: undefined,
      safeData: undefined,
    });
    await this.audit("operation.started", operationId, { entryMethodId: entry.id });
    this.options.ports.logger?.info("Customer operation started", {
      action: "start",
      data: { entryMethodId: entry.id, operationId },
      eventId: "operation.started",
      module: "kiosk-runtime",
      requestId: operationId,
    });

    try {
      ensureNotAborted(abort.signal);
      const assessment = await entry.acquisition.acquire(ctx);
      ensureNotAborted(abort.signal);
      await this.options.prepareOperation?.(ctx, assessment);
      ensureNotAborted(abort.signal);
      const plan = this.authenticationPolicy.build(assessment, this.capabilities);
      this.setView({ phase: "authenticating" });
      await this.options.ports.ledger.update(idempotencyKey, { phase: "authenticating" });

      for (const item of plan.items) {
        ensureNotAborted(abort.signal);
        const challenge = this.challenges.require(item.challengeId);
        if (this.active?.operationId === operationId) {
          for (const capabilityId of challenge.requiredCapabilities ?? []) {
            this.active.requiredCapabilities.add(capabilityId);
          }
        }
        if (challenge.version !== item.challengeVersion) {
          throw operationError("authentication.version.changed", "Authentication version changed.");
        }
        const challengeContext: AuthenticationChallengeContext = {
          ...ctx,
          credential: assessment.credential,
        };
        const result = await challenge.execute(challengeContext, item.requirement);
        if (!result.authenticated) {
          throw operationError(
            result.reasonCode ?? "authentication.rejected",
            "Authentication was rejected.",
          );
        }
      }

      this.setView({ phase: "processing" });
      await this.options.ports.ledger.update(idempotencyKey, { phase: "processing" });
      safeOutput = await this.options.executeBusiness?.(ctx, assessment);
      outcome = "completed";
      const custody = await this.resolveCustody(entry, ctx, outcome);
      await this.applyCustodyResolution(idempotencyKey, custody.status, custody.reasonCode);
      if (custody.status === "unknown") {
        return this.result(operationId, entry.id, "intervention", undefined, custody.reasonCode);
      }
      await this.options.ports.ledger.complete(idempotencyKey, safeOutput);
      this.setView({ phase: "completed", safeData: asSafeData(safeOutput) });
      await this.audit("operation.completed", operationId, { entryMethodId: entry.id });
      this.options.ports.logger?.info("Customer operation completed", {
        action: "complete",
        data: { entryMethodId: entry.id, operationId },
        eventId: "operation.completed",
        module: "kiosk-runtime",
        requestId: operationId,
      });
      return this.result(operationId, entry.id, "completed", safeOutput);
    } catch (error) {
      outcome = abort.signal.aborted ? "interrupted" : "failed";
      const reasonCode = errorCode(error, abort.signal);
      const custody = await this.resolveCustody(entry, ctx, outcome);
      await this.applyCustodyResolution(idempotencyKey, custody.status, custody.reasonCode);
      if (custody.status === "unknown") {
        return this.result(operationId, entry.id, "intervention", undefined, custody.reasonCode);
      }
      await this.options.ports.ledger.fail(idempotencyKey, reasonCode);
      this.setView({
        feedback: { messageKey: reasonCode, reasonCode, severity: "error" },
        phase: outcome,
      });
      await this.audit(`operation.${outcome}`, operationId, {
        entryMethodId: entry.id,
        reasonCode,
      });
      this.options.ports.logger?.warn(`Customer operation ${outcome}`, {
        action: outcome,
        data: { entryMethodId: entry.id, operationId, reasonCode },
        eventId: `operation.${outcome}`,
        module: "kiosk-runtime",
        requestId: operationId,
      });
      return this.result(operationId, entry.id, outcome, undefined, reasonCode);
    } finally {
      clearTimeout(deadline);
      try {
        await this.options.ports.prompt?.cancelOperation(operationId, "operation.exit");
      } finally {
        try {
          this.options.onOperationExit?.({ entryMethodId: entry.id, operationId, outcome });
        } finally {
          try {
            await this.options.ports.scopedStore.resetTransaction(`operation.${outcome}`);
          } finally {
            compensationAbort.abort("operation.compensationComplete");
            this.active = undefined;
          }
        }
      }
    }
  }

  private context(
    entryMethodId: string,
    operationId: string,
    deadlineAt: number,
    signal: AbortSignal,
    compensationSignal: AbortSignal,
    idempotencyKey: string,
  ): OperationExecutionContext {
    return {
      capabilities: this.capabilities,
      compensationSignal,
      deadlineAt,
      entryMethodId,
      mode: this.options.mode,
      operationId,
      prompt: this.options.ports.prompt,
      signal,
      consumeAttempt: (policyId) => this.consumeAttempt(policyId),
      getMediaCustody: () => this.state.mediaCustody,
      interactionTimeout: (policyId) => {
        const now = this.options.now?.() ?? Date.now();
        const remaining = Math.max(1, deadlineAt - now);
        const configured =
          this.options.policy.interactionTimeouts[policyId] ??
          this.options.policy.interactionTimeouts.input ??
          remaining;
        const accessibility = this.options.accessibilityInteraction;
        const multiplier = accessibility
          ? Math.min(
              Math.max(1, accessibility.timeoutMultiplier),
              Math.max(1, accessibility.maximumTimeoutMultiplier),
            )
          : 1;
        return Math.max(1, Math.min(configured * multiplier, remaining));
      },
      setMediaCustody: async (status) => {
        await this.options.ports.ledger.update(idempotencyKey, { mediaCustody: status });
        this.setView({ mediaCustody: status });
      },
      updateView: (patch) => this.setView(patch),
    };
  }

  private consumeAttempt(policyId: string): number {
    const attempt = (this.attempts.get(policyId) ?? 0) + 1;
    const budget = this.options.policy.attemptBudgets[policyId];
    if (budget !== undefined && attempt > budget) {
      throw operationError(
        "operation.attemptBudgetExceeded",
        `Attempt budget exceeded: ${policyId}`,
      );
    }
    this.attempts.set(policyId, attempt);
    return attempt;
  }

  private resolveCustody(
    entry: EntryMethodContribution,
    ctx: OperationExecutionContext,
    outcome: "completed" | "failed" | "interrupted",
  ): Promise<MediaCustodyResolution> {
    const custody = ctx.getMediaCustody();
    if (entry.mediaCustody.kind === "none" || custody === "none") {
      return Promise.resolve({ status: "none" });
    }
    if (custody === "returned" || custody === "retained") {
      return Promise.resolve({ status: custody });
    }
    if (custody === "unknown") {
      return Promise.resolve({ reasonCode: "custody.unknown", status: "unknown" });
    }
    return entry.mediaCustody.resolve(ctx, outcome);
  }

  private async applyCustodyResolution(
    idempotencyKey: string,
    status: "returned" | "retained" | "unknown" | "none",
    reasonCode?: string,
  ): Promise<void> {
    if (status === "unknown") {
      await this.markIntervention(idempotencyKey, reasonCode);
      return;
    }
    await this.options.ports.ledger.update(idempotencyKey, { mediaCustody: status });
    this.setView({ mediaCustody: status });
  }

  private async markIntervention(idempotencyKey: string, reasonCode?: string): Promise<void> {
    this.intervention = true;
    await this.options.ports.ledger.update(idempotencyKey, {
      errorCode: reasonCode ?? "custody.unknown",
      mediaCustody: "unknown",
      status: "intervention",
    });
    this.setView({ mediaCustody: "unknown", phase: "intervention" });
  }

  private setView(patch: OperationViewPatch): void {
    const previousPromptKey = promptKey(this.state);
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 };
    this.options.ports.ui.setState({}, "kiosk.operation", this.state);
    for (const listener of this.listeners) {
      listener(this.state);
    }
    if (promptKey(this.state) !== previousPromptKey) {
      const intent = this.options.promptIntent?.(this.state);
      if (intent && this.options.ports.prompt) {
        void this.options.ports.prompt
          .present(intent)
          .then((session) => session.completed)
          .catch(() => undefined);
      }
    }
  }

  private async audit(eventId: string, operationId: string, data: JsonValue): Promise<void> {
    await this.options.ports.audit?.append({
      data,
      eventId,
      message: eventId,
      transactionId: operationId,
    });
  }

  private result(
    operationId: string,
    entryMethodId: string,
    status: CustomerOperationResult["status"],
    safeOutput?: JsonValue,
    reasonCode?: string,
  ): CustomerOperationResult {
    return { operationId, entryMethodId, status, safeOutput, reasonCode };
  }
}

const operationError = (code: string, message: string): FrameworkError =>
  new FrameworkError({ category: "dependency", code, message });

const ensureNotAborted = (signal: AbortSignal): void => {
  if (signal.aborted) {
    throw operationError(
      String(signal.reason ?? "operation.interrupted"),
      "Operation interrupted.",
    );
  }
};

const errorCode = (error: unknown, signal: AbortSignal): string => {
  if (signal.aborted) {
    return String(signal.reason ?? "operation.interrupted");
  }
  return error instanceof FrameworkError ? error.code : "operation.failed";
};

const asSafeData = (
  value: JsonValue | undefined,
): Readonly<Record<string, JsonValue>> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>)
    : undefined;

const promptKey = (state: OperationViewState): string | undefined =>
  state.operationId && state.promptId ? `${state.operationId}:${state.promptId}` : undefined;
