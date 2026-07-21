import type {
  CashAcceptanceResult,
  CashAcceptanceSession,
  CashAcceptanceSnapshot,
} from "@tripley-kit/web-container-xfs-device-service";

import type {
  DepositHostAuthorizationResult,
  DepositOrchestratorOptions,
  DepositOutcome,
  DepositPolicy,
  DepositReason,
  DepositRequest,
  DepositReturnedMediaResolution,
  DepositStatus,
  DepositTrigger,
} from "./contracts";
import {
  applyAcceptanceResult,
  buildDepositOutcome,
  observeEscrow,
  recordAfterInventoryFailure,
  recordInventory,
  recordRefusedResolution,
  type DepositOperationState,
} from "./outcome";
import { requestTimeout, reviewFailure } from "./workflow-decisions";

export const runDepositWorkflow = (
  options: DepositOrchestratorOptions,
  request: DepositRequest,
  policy: DepositPolicy,
  state: DepositOperationState,
): Promise<DepositOutcome> => new DepositWorkflow(options, request, policy, state).run();

class DepositWorkflow {
  public constructor(
    private readonly options: DepositOrchestratorOptions,
    private readonly request: DepositRequest,
    private readonly policy: DepositPolicy,
    private readonly state: DepositOperationState,
  ) {}

  public async run(): Promise<DepositOutcome> {
    if (!await this.captureBefore()) return this.outcome("failed", "inventory-before-failed");
    if (this.request.signal?.aborted) {
      await this.captureAfter();
      return this.interruptedOutcome();
    }

    const session = await this.startSession();
    if (!session) {
      await this.captureAfter();
      return this.outcome("failed", "cash-acceptance-start-failed");
    }

    try {
      const reviewOutcome = await this.collectAndReview(session);
      if (reviewOutcome) return reviewOutcome;
      return await this.authorizeAndCommit(session);
    } catch {
      await this.abort(session, "cancelled");
      await this.captureAfter();
      return this.outcome("intervention", "unexpected-failure", "interrupt");
    }
  }

  private async startSession(): Promise<CashAcceptanceSession | undefined> {
    try {
      return await this.options.cash.start({
        logicalService: this.policy.logicalService,
        operationId: this.request.operationId,
        policy: this.policy.acceptancePolicy,
        resourceGroup: this.policy.resourceGroup,
        ...(this.request.signal ? { signal: this.request.signal } : {}),
      });
    } catch {
      return undefined;
    }
  }

  private async collectAndReview(session: CashAcceptanceSession): Promise<DepositOutcome | undefined> {
    for (let batchNumber = 1; batchNumber <= this.policy.maxBatches; batchNumber += 1) {
      if (this.request.signal?.aborted) {
        await this.abort(session, requestTimeout(this.request) ? "timeout" : "cancelled");
        await this.captureAfter();
        return this.interruptedOutcome();
      }

      const snapshot = await this.acceptBatch(session);
      if (!snapshot) return this.abortAfterAcceptanceFailure(session);
      const refusedOutcome = await this.persistEscrowAndResolveRefused(session, snapshot);
      if (refusedOutcome) return refusedOutcome;
      const reviewOutcome = await this.evaluateReview(session, snapshot, batchNumber);
      if (reviewOutcome === "accept-more") continue;
      if (reviewOutcome) return reviewOutcome;
      return undefined;
    }
    throw new Error("Deposit review loop ended without a decision");
  }

  private async acceptBatch(session: CashAcceptanceSession): Promise<CashAcceptanceSnapshot | undefined> {
    try {
      return await session.acceptBatch();
    } catch {
      return undefined;
    }
  }

  private async abortAfterAcceptanceFailure(session: CashAcceptanceSession): Promise<DepositOutcome> {
    await this.abort(session, "cancelled");
    await this.captureAfter();
    return this.outcome("failed", "cash-acceptance-failed", "interrupt");
  }

  private async persistEscrowAndResolveRefused(
    session: CashAcceptanceSession,
    snapshot: CashAcceptanceSnapshot,
  ): Promise<DepositOutcome | undefined> {
    const newRefusedCount = observeEscrow(this.state, snapshot);
    try {
      await this.options.transactions.markEscrow(this.request.operationId, snapshot);
    } catch {
      return this.abortUnexpected(session);
    }
    if (newRefusedCount === 0) return undefined;

    const resolution = await this.resolveRefused(newRefusedCount);
    recordRefusedResolution(this.state, newRefusedCount, resolution);
    if (resolution.status === "taken" || resolution.status === "retracted") return undefined;
    await this.abort(session, "cancelled");
    await this.captureAfter();
    return this.outcome("intervention", "refused-media-unresolved");
  }

  private async evaluateReview(
    session: CashAcceptanceSession,
    snapshot: CashAcceptanceSnapshot,
    batchNumber: number,
  ): Promise<"accept-more" | DepositOutcome | undefined> {
    let decision;
    try {
      decision = await this.options.reviewGates.evaluate(this.policy.reviewGateId, {
        batchNumber,
        maxBatches: this.policy.maxBatches,
        operationId: this.request.operationId,
        snapshot,
        ...(this.request.signal ? { signal: this.request.signal } : {}),
      });
    } catch {
      return this.abortUnexpected(session);
    }
    if (decision.decision === "confirm") return undefined;
    if (decision.decision === "accept-more" && batchNumber < this.policy.maxBatches) {
      return "accept-more";
    }

    const failure = reviewFailure(decision.decision, batchNumber === this.policy.maxBatches);
    await this.abort(session, failure.abortReason);
    await this.captureAfter();
    return this.outcome(failure.status, failure.reason, failure.trigger);
  }

  private async authorizeAndCommit(session: CashAcceptanceSession): Promise<DepositOutcome> {
    let authorization: DepositHostAuthorizationResult;
    try {
      authorization = await session.authorize({
        authorize: (snapshot) => this.authorizeHost(snapshot),
      }) as DepositHostAuthorizationResult;
    } catch {
      return this.abortAfterAuthorizationFailure(session);
    }

    try {
      await this.options.transactions.markAuthorized(this.request.operationId, authorization);
      await this.options.audit.append({
        data: { hostStatus: "approved", revision: authorization.revision },
        eventId: "deposit.authorized",
        message: "Deposit exact escrow revision authorized",
        operationId: this.request.operationId,
      });
    } catch {
      return this.abortUnexpected(session);
    }
    return this.commit(session, authorization);
  }

  private async abortAfterAuthorizationFailure(session: CashAcceptanceSession): Promise<DepositOutcome> {
    const declined = this.state.host.status === "declined";
    const result = await this.abort(session, "cancelled");
    await this.captureAfter();
    return this.outcome(
      declined ? "declined" : "failed",
      declined ? "host-declined" : "host-unavailable",
      result ? undefined : "interrupt",
    );
  }

  private async commit(
    session: CashAcceptanceSession,
    authorization: DepositHostAuthorizationResult,
  ): Promise<DepositOutcome> {
    this.state.physical = { ...this.state.physical, commit: "dispatched" };
    try {
      applyAcceptanceResult(this.state, await session.commit(authorization));
    } catch {
      this.state.physical = {
        ...this.state.physical,
        commit: "execution-unknown",
        reconciliationRequired: true,
      };
      await this.abort(session, "cancelled");
      await this.captureAfter();
      return this.outcome("intervention", "physical-commit-unknown", "interrupt");
    }

    await this.captureAfter();
    return this.state.inventory.afterCaptureFailed
      ? this.outcome("intervention", "inventory-after-failed")
      : this.outcome("completed", "committed");
  }

  private async authorizeHost(snapshot: CashAcceptanceSnapshot): Promise<DepositHostAuthorizationResult> {
    try {
      const authorization = await this.options.host.authorize({
        operationId: this.request.operationId,
        protocol: this.policy.hostProtocol,
        snapshot,
        ...(this.request.safeMetadata ? { safeMetadata: this.request.safeMetadata } : {}),
      });
      this.state.host = {
        ...this.state.host,
        status: authorization.approved ? "approved" : "declined",
        ...(authorization.authorizationReference
          ? { authorizationReference: authorization.authorizationReference }
          : {}),
        ...(authorization.reasonCode ? { reasonCode: authorization.reasonCode } : {}),
      };
      return authorization;
    } catch (error) {
      this.state.host = { ...this.state.host, status: "unavailable" };
      throw error;
    }
  }

  private async resolveRefused(refusedCount: number): Promise<DepositReturnedMediaResolution> {
    if (!this.options.returnedMedia) return { status: "unknown" };
    try {
      return await this.options.returnedMedia.resolveRefused({
        logicalService: this.policy.logicalService,
        operationId: this.request.operationId,
        refusedCount,
        ...(this.request.signal ? { signal: this.request.signal } : {}),
      });
    } catch {
      return { status: "unknown" };
    }
  }

  private async abort(
    session: CashAcceptanceSession,
    reason: "cancelled" | "timeout",
  ): Promise<CashAcceptanceResult | undefined> {
    try {
      const result = await session.abort(reason);
      applyAcceptanceResult(this.state, result);
      return result;
    } catch {
      this.state.physical = { ...this.state.physical, reconciliationRequired: true };
      this.state.portions.push({
        custody: "unknown",
        kind: "returned",
        noteCount: this.state.escrow.acceptedNoteCount,
        portionId: "escrow",
        reason: "abort-failed",
      });
      return undefined;
    }
  }

  private async abortUnexpected(session: CashAcceptanceSession): Promise<DepositOutcome> {
    await this.abort(session, "cancelled");
    await this.captureAfter();
    return this.outcome("intervention", "unexpected-failure", "interrupt");
  }

  private async captureBefore(): Promise<boolean> {
    try {
      recordInventory(this.state, await this.captureInventory("before"));
      return true;
    } catch {
      return false;
    }
  }

  private async captureAfter(): Promise<void> {
    try {
      recordInventory(this.state, await this.captureInventory("after"));
    } catch {
      recordAfterInventoryFailure(this.state);
    }
  }

  private captureInventory(boundary: "before" | "after") {
    return this.options.inventory.capture({
      boundary,
      logicalService: this.policy.logicalService,
      operationId: this.request.operationId,
      resourceGroup: this.policy.resourceGroup,
    });
  }

  private interruptedOutcome(): DepositOutcome {
    return requestTimeout(this.request)
      ? this.outcome("timedOut", "customer-timeout", "timeout")
      : this.outcome("cancelled", "customer-cancelled", "cancel");
  }

  private outcome(
    status: DepositStatus,
    reason: DepositReason,
    trigger?: DepositTrigger,
  ): DepositOutcome {
    return buildDepositOutcome(this.request, this.policy, this.state, status, reason, trigger);
  }
}
