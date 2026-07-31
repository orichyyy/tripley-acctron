import type { XfsCardReaderPort } from "./ports";
import type {
  CardCustodyAuthorityMode,
  CardCustodyEvidence,
  CardCustodyEvidenceAction,
  CardCustodyEvidenceSink,
  CardCustodyInterruptReason,
  CardCustodyLeasePort,
  CardCustodyLeaseSession,
  CardCustodyPolicy,
  CardCustodyReconcileRequest,
  CardCustodyRequest,
  CardCustodyResolutionAction,
  CardCustodyResult,
  CardCustodyStatus,
  CardCustodyReason,
} from "./card-custody-contracts";
import type { CardCustodyPolicyRegistry } from "./card-custody-policy";
import type { XfsCardMediaState } from "./types";

export interface CardCustodyServiceOptions {
  readonly card: XfsCardReaderPort;
  readonly logicalService: string;
  readonly resourceGroup?: string | undefined;
  readonly policies: CardCustodyPolicyRegistry;
  readonly leases: CardCustodyLeasePort;
  readonly evidence: CardCustodyEvidenceSink;
  readonly now?: (() => Date) | undefined;
}

export class CardCustodyService {
  readonly #resourceGroup: string;
  readonly #now: () => Date;

  public constructor(private readonly options: CardCustodyServiceOptions) {
    if (!options.logicalService.trim()) throw new Error("logicalService is required");
    this.#resourceGroup = options.resourceGroup ?? `card:${options.logicalService}`;
    this.#now = options.now ?? (() => new Date());
  }

  public async returnCard(request: CardCustodyRequest): Promise<CardCustodyResult> {
    const policy = this.options.policies.require(request.policyId);
    return this.withAuthority(request.operationId, "recovery", request.authority, async (operation) => {
      if (request.signal?.aborted) {
        return operation.finish("cancelled", interruptReason(request), "unknown");
      }
      await operation.record("eject-requested");
      try {
        await this.options.card.ejectCard(
          { timeoutMs: policy.takeTimeoutMs, position: "exit" },
          { operationId: request.operationId, signal: request.signal },
        );
      } catch (error) {
        const reason = request.signal?.aborted ? interruptReason(request) : "eject-failed";
        return operation.finish(
          request.signal?.aborted ? "cancelled" : "intervention",
          reason,
          await this.safeMediaState(),
          safeFailureCode(error),
        );
      }
      await operation.record("eject-completed", { mediaState: "presented" });
      return this.awaitTake(request, policy, operation);
    });
  }

  public async retainCard(request: CardCustodyRequest): Promise<CardCustodyResult> {
    this.options.policies.require(request.policyId);
    return this.withAuthority(request.operationId, "recovery", request.authority, async (operation) =>
      this.retain(operation, "retained-by-policy"),
    );
  }

  public async reconcile(request: CardCustodyReconcileRequest): Promise<CardCustodyResult> {
    return this.withAuthority(request.operationId, "observation", undefined, async (operation) => {
      const state = await this.safeMediaState();
      await operation.record("media-observed", { mediaState: state });
      if (state === "presented") {
        return operation.finish("presented", "recovery-presented", state);
      }
      if (state === "inside") {
        return operation.finish("inside", "recovery-inside", state);
      }
      if (state === "jammed") {
        return operation.finish("intervention", "media-jammed", state);
      }
      return operation.finish("intervention", "custody-unknown", state);
    });
  }

  private async awaitTake(
    request: CardCustodyRequest,
    policy: CardCustodyPolicy,
    operation: CustodyOperation,
  ): Promise<CardCustodyResult> {
    try {
      const taken = await this.options.card.waitForTaken(
        { pollIntervalMs: policy.pollIntervalMs, timeoutMs: policy.takeTimeoutMs },
        { operationId: request.operationId, signal: request.signal },
      );
      await operation.record("media-observed", { mediaState: taken.status.state });
      if (taken.taken) return operation.finish("returned", "taken", taken.status.state);
      return this.resolve(
        operation,
        policy.takeTimeoutAction,
        "take-timeout",
        taken.status.state,
      );
    } catch (error) {
      if (!request.signal?.aborted) {
        return operation.finish(
          "intervention",
          "custody-unknown",
          await this.safeMediaState(),
          safeFailureCode(error),
        );
      }
      const reason = interruptReason(request);
      const action = policy.interruptActions?.[reason] ?? "intervention";
      return this.resolve(operation, action, reason, await this.safeMediaState());
    }
  }

  private async resolve(
    operation: CustodyOperation,
    action: CardCustodyResolutionAction,
    reason: CardCustodyReason,
    mediaState: XfsCardMediaState,
  ): Promise<CardCustodyResult> {
    if (action === "retain") return this.retain(operation, reason);
    if (action === "leave-presented") {
      return operation.finish("presented", reason, mediaState);
    }
    return operation.finish("intervention", reason, mediaState);
  }

  private async retain(
    operation: CustodyOperation,
    reason: CardCustodyReason,
  ): Promise<CardCustodyResult> {
    await operation.record("retain-requested");
    try {
      await this.options.card.retainCard();
      await operation.record("retain-completed", { mediaState: "notPresent" });
      return operation.finish("retained", reason, "notPresent");
    } catch (error) {
      return operation.finish(
        "intervention",
        "retain-failed",
        await this.safeMediaState(),
        safeFailureCode(error),
      );
    }
  }

  private async safeMediaState(): Promise<XfsCardMediaState> {
    try {
      return (await this.options.card.getMediaStatus()).state;
    } catch {
      return "unknown";
    }
  }

  private async withAuthority(
    operationId: string,
    authority: CardCustodyAuthorityMode,
    existingLease: CardCustodyLeaseSession | undefined,
    execute: (operation: CustodyOperation) => Promise<CardCustodyResult>,
  ): Promise<CardCustodyResult> {
    let lease: CardCustodyLeaseSession;
    if (existingLease) {
      lease = existingLease;
      if (authority === "recovery") {
        await lease.transitionToRecovery();
      }
    } else {
      try {
        lease = await this.options.leases.acquire({
          authority,
          logicalService: this.options.logicalService,
          operationId,
          resourceGroup: this.#resourceGroup,
        });
      } catch (error) {
        return result(operationId, this.options.logicalService, "intervention", "authority-rejected", "unknown", false, undefined, safeFailureCode(error));
      }
    }

    const operation = new CustodyOperation({
      evidence: this.options.evidence,
      lease,
      logicalService: this.options.logicalService,
      now: this.#now,
      operationId,
    });
    await operation.record("authority-acquired");
    let outcome: CardCustodyResult;
    try {
      outcome = await execute(operation);
    } catch (error) {
      outcome = operation.result("intervention", "evidence-write-failed", "unknown", safeFailureCode(error));
    }
    try {
      await lease.release({
        acknowledgeProtection: outcome.status === "returned" || outcome.status === "retained",
      });
      await operation.recordBestEffort("authority-released");
      return { ...outcome, authorityReleased: true, safeSummary: { ...outcome.safeSummary, authorityReleased: true } };
    } catch (error) {
      await operation.recordBestEffort("authority-release-failed", { failureCode: safeFailureCode(error) });
      return { ...outcome, authorityReleased: false, failureCode: outcome.failureCode ?? safeFailureCode(error), safeSummary: { ...outcome.safeSummary, authorityReleased: false } };
    }
  }
}

class CustodyOperation {
  private sequence = 0;

  public constructor(private readonly options: {
    readonly evidence: CardCustodyEvidenceSink;
    readonly lease: CardCustodyLeaseSession;
    readonly logicalService: string;
    readonly now: () => Date;
    readonly operationId: string;
  }) {}

  public async finish(status: CardCustodyStatus, reason: CardCustodyReason, mediaState: XfsCardMediaState, failureCode?: string): Promise<CardCustodyResult> {
    const outcome = this.result(status, reason, mediaState, failureCode);
    await this.recordBestEffort("terminal", { failureCode, mediaState, reason, status });
    return outcome;
  }

  public result(status: CardCustodyStatus, reason: CardCustodyReason, mediaState: XfsCardMediaState, failureCode?: string): CardCustodyResult {
    return result(this.options.operationId, this.options.logicalService, status, reason, mediaState, false, this.options.lease, failureCode);
  }

  public async record(action: CardCustodyEvidenceAction, extra: Partial<CardCustodyEvidence> = {}): Promise<void> {
    await this.options.evidence.append(this.evidence(action, extra));
  }

  public async recordBestEffort(action: CardCustodyEvidenceAction, extra: Partial<CardCustodyEvidence> = {}): Promise<void> {
    await this.options.evidence.append(this.evidence(action, extra)).catch(() => undefined);
  }

  private evidence(action: CardCustodyEvidenceAction, extra: Partial<CardCustodyEvidence>): CardCustodyEvidence {
    return {
      action,
      fencingToken: this.options.lease.fencingToken,
      hostEpoch: this.options.lease.hostEpoch,
      kind: "card.custody",
      logicalService: this.options.logicalService,
      occurredAt: this.options.now().toISOString(),
      operationId: this.options.operationId,
      safeSummary: { action, logicalService: this.options.logicalService },
      sequence: ++this.sequence,
      ...extra,
    };
  }
}

export class CompositeCardCustodyEvidenceSink implements CardCustodyEvidenceSink {
  public constructor(private readonly sinks: readonly CardCustodyEvidenceSink[]) {}

  public async append(evidence: CardCustodyEvidence): Promise<void> {
    for (const sink of this.sinks) await sink.append(evidence);
  }
}

export const cardCustodyAllowsCashPresentation = (outcome: CardCustodyResult): boolean =>
  outcome.status === "returned";

const interruptReason = (request: CardCustodyRequest): CardCustodyInterruptReason => {
  if (request.interruptReason) return request.interruptReason;
  const reason = request.signal?.reason;
  if (typeof reason === "string") {
    if (/timeout/i.test(reason)) return "operation-timeout";
    if (/node.?exit|route.?exit/i.test(reason)) return "node-exit";
    if (/device/i.test(reason)) return "device-loss";
  }
  return "user-cancelled";
};

const safeFailureCode = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return error instanceof Error ? error.name : "unknown";
};

const result = (
  operationId: string,
  logicalService: string,
  status: CardCustodyStatus,
  reason: CardCustodyReason,
  mediaState: XfsCardMediaState,
  authorityReleased: boolean,
  authority?: CardCustodyLeaseSession,
  failureCode?: string,
): CardCustodyResult => ({
  ...(authority ? { authority: { fencingToken: authority.fencingToken, hostEpoch: authority.hostEpoch } } : {}),
  authorityReleased,
  ...(failureCode ? { failureCode } : {}),
  logicalService,
  mediaState,
  operationId,
  reason,
  safeSummary: { authorityReleased, logicalService, mediaState, reason, status },
  status,
});
