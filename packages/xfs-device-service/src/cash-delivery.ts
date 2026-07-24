import { FrameworkError } from "@tripley-kit/web-container-errors";

import type {
  CashAmount,
  CashCustodyOutcome,
  CashDeliveryDependencies,
  CashDeliveryPhase,
  CashDispensePlan,
  CashInventorySnapshot,
  CashOperationEvidence,
  CashRecoveryTransferReceipt,
  HeldCashSessionResources,
} from "./cash-contracts";
import type { CashPresentationAuthorization, CashPresentationPolicy } from "./cash-policy";
import type {
  XfsCdmClientLike,
  XfsCdmOperationalPolicy,
  XfsCommandLeaseClientLike,
  XfsSessionLike,
} from "./types";
import { assertXfsOk, hResultOf } from "./utils";

export interface StartCashDeliveryRequest {
  readonly operationId: string;
  readonly ownerInstanceId: string;
  readonly amount: CashAmount;
  readonly presentationPolicy: CashPresentationPolicy;
}

export interface StartCashDeliveryResult {
  readonly before: CashInventorySnapshot;
  readonly plan: CashDispensePlan;
  readonly session: CashDeliverySession;
}

export interface CashDeliveryTerminalResult {
  readonly outcome: CashCustodyOutcome;
  readonly reconciliationRequired: boolean;
  readonly after?: CashInventorySnapshot | undefined;
  readonly safeSummary: Readonly<Record<string, unknown>>;
}

export type CashDeliveryExitResult =
  | { readonly status: "terminal"; readonly result: CashDeliveryTerminalResult }
  | { readonly status: "transferred"; readonly receipt: CashRecoveryTransferReceipt };

export interface CashDeliveryPort {
  start(request: StartCashDeliveryRequest): Promise<StartCashDeliveryResult>;
  observeInventory(operationId: string, cashSessionId: string): Promise<CashInventorySnapshot>;
}

interface CashDeliveryPortOptions {
  readonly client: XfsCdmClientLike;
  readonly commandLeases: XfsCommandLeaseClientLike;
  readonly dependencies: CashDeliveryDependencies;
  readonly deviceId: string;
  readonly logicalName: string;
  readonly policy: XfsCdmOperationalPolicy;
  readonly session: XfsSessionLike;
  readonly sessionGeneration: number;
  readonly timeoutMs: number;
}

export class XfsCashDeliveryPort implements CashDeliveryPort {
  public constructor(private readonly options: CashDeliveryPortOptions) {}

  public async start(request: StartCashDeliveryRequest): Promise<StartCashDeliveryResult> {
    validateAmount(request.amount);
    if (await this.options.dependencies.recoveryLeases.hasUnresolved(this.options.logicalName)) {
      throw cashError(
        "cash.recovery.unresolved",
        "A new cash operation cannot start while recovery ownership is unresolved.",
      );
    }
    const cashSessionId = this.id();
    const resources = await this.acquireResources(request, cashSessionId);
    try {
      const before = await this.observeInventory(request.operationId, cashSessionId, "before");
      const evidence = evidenceRecord(this.options.dependencies, {
        cashSessionId,
        kind: "cash.before.persisted",
        operationId: request.operationId,
        phase: "planning",
        sequence: 1,
        source: "device",
        certainty: "observed",
      });
      await this.options.dependencies.evidence.recordBeforeMovement({
        evidence,
        snapshot: before,
        ejProjection: safeSnapshotProjection(before),
      });
      const denomination = await this.denominate(request.amount);
      const plan = Object.freeze({
        cashSessionId,
        cashUnitRevision: before.revision,
        denomination,
        expiresAt: Date.now() + (this.options.policy.planTtlMs ?? 30_000),
        id: this.id(),
        logicalService: this.options.logicalName,
        operationId: request.operationId,
        policyVersion: this.options.policy.policyVersion,
        sessionGeneration: this.options.sessionGeneration,
      });
      const session = new CashDeliverySession({
        ...this.options,
        amount: request.amount,
        before,
        cashSessionId,
        operationId: request.operationId,
        plan,
        presentationPolicy: request.presentationPolicy,
        resources,
      });
      return { before, plan, session };
    } catch (error) {
      await releaseResources(this.options, resources, "notDispensed");
      throw error;
    }
  }

  public observeInventory(
    operationId: string,
    cashSessionId: string,
    boundary: CashInventorySnapshot["boundary"] = "recovery",
  ): Promise<CashInventorySnapshot> {
    return captureSnapshot(this.options, operationId, cashSessionId, boundary, this.id());
  }

  private async acquireResources(
    request: StartCashDeliveryRequest,
    cashSessionId: string,
  ): Promise<HeldCashSessionResources> {
    const deviceLease = await this.options.dependencies.deviceLocks.acquire(
      [this.options.deviceId],
      { owner: { id: request.operationId, type: "cashDelivery" }, reason: "cash custody" },
    );
    try {
      const recoveryLease = await this.options.dependencies.recoveryLeases.acquire({
        cashSessionId,
        logicalService: this.options.logicalName,
        operationId: request.operationId,
        ownerInstanceId: request.ownerInstanceId,
      });
      const hostEpoch = await this.options.commandLeases.getHostEpoch();
      const hostCommandLease = await this.options.commandLeases.acquire({
        authority: "transaction",
        fencingToken: recoveryLease.fencingToken,
        hostEpoch,
        logicalService: this.options.logicalName,
        operationId: request.operationId,
        ttlMs: this.options.policy.commandLeaseTtlMs ?? this.options.timeoutMs * 2,
        resourceGroup: this.options.policy.resourceGroup ?? this.options.logicalName,
        ownerInstanceId: request.ownerInstanceId,
        protectionPolicyProfileId:
          this.options.policy.protectionPolicyProfileId ?? "standard",
      });
      return { deviceLease, hostCommandLease, recoveryLease };
    } catch (error) {
      await deviceLease.release();
      throw error;
    }
  }

  private async denominate(amount: CashAmount): Promise<CashDispensePlan["denomination"]> {
    const requested = {
      amount: amount.minorUnits,
      cashBox: 0,
      currencyId: amount.currency,
      values: new Uint8Array(),
    };
    const result = await this.options.client.denominate({
      denomination: requested,
      mixNumber: this.options.policy.mixNumber ?? 1,
      sessionId: this.options.session.id,
      tellerId: this.options.policy.tellerId ?? 0,
      timeoutMs: this.options.timeoutMs,
    });
    assertXfsOk(result, "cdm.denominate", this.metadata());
    return result.denomination ?? requested;
  }

  private metadata(): Record<string, unknown> {
    return { deviceId: this.options.deviceId, logicalName: this.options.logicalName, module: "cdm" };
  }

  private id(): string {
    return this.options.dependencies.idFactory?.() ?? defaultId();
  }
}

interface CashDeliverySessionOptions extends CashDeliveryPortOptions {
  readonly amount: CashAmount;
  readonly before: CashInventorySnapshot;
  readonly cashSessionId: string;
  readonly operationId: string;
  readonly plan: CashDispensePlan;
  readonly presentationPolicy: CashPresentationPolicy;
  readonly resources: HeldCashSessionResources;
}

export class CashDeliverySession {
  private takeEventObserved = false;
  private takeSubscription?: { unsubscribe(): void } | undefined;
  private currentPhase: CashDeliveryPhase = "planned";
  private sequence = 1;
  private planConsumed = false;
  private movementPossible = false;
  private retractDispatched = false;
  private reconciliationRequired = false;
  private recoveryTransferred = false;
  private terminal?: CashDeliveryTerminalResult;
  private readonly consumedAuthorizations = new Set<string>();

  public constructor(private readonly options: CashDeliverySessionOptions) {}

  public get id(): string { return this.options.cashSessionId; }
  public get phase(): CashDeliveryPhase { return this.currentPhase; }
  public get isTerminal(): boolean { return this.currentPhase === "terminal"; }

  public async dispense(plan: CashDispensePlan): Promise<void> {
    this.requireForegroundOwnership();
    this.requirePhase("planned");
    this.validatePlan(plan);
    this.planConsumed = true;
    this.currentPhase = "dispensing";
    await this.record("cash.dispense.intent", "flow", "observed");
    this.movementPossible = true;
    try {
      const result = await this.options.client.dispense({
        denomination: plan.denomination,
        mixNumber: this.options.policy.mixNumber ?? 1,
        position: this.options.policy.outputPosition ?? 2,
        present: false,
        sessionId: this.options.session.id,
        tellerId: this.options.policy.tellerId ?? 0,
        timeoutMs: this.options.timeoutMs,
      });
      assertXfsOk(result, "cdm.dispense", this.metadata());
      this.currentPhase = "staged";
      await this.recordSafely("cash.dispense.completed", "device", "deviceReported", hResultOf(result));
      await this.updateRecovery();
    } catch (error) {
      this.currentPhase = "reconciling";
      this.reconciliationRequired = true;
      await this.recordSafely("cash.dispense.executionUnknown", "device", "unknown");
      throw error;
    }
  }

  public async present(authorization: CashPresentationAuthorization): Promise<void> {
    this.requireForegroundOwnership();
    this.requirePhase("staged");
    this.validateAuthorization(authorization);
    this.consumedAuthorizations.add(authorization.id);
    this.currentPhase = "presenting";
    await this.recordSafely("cash.present.intent", "policy", "observed");
    this.startTakeObservation();
    try {
      const result = await this.options.client.present(this.positionRequest());
      assertXfsOk(result, "cdm.present", this.metadata());
      this.currentPhase = "awaitingTake";
      await this.recordSafely("cash.present.completed", "device", "deviceReported", hResultOf(result));
      await this.updateRecovery();
    } catch (error) {
      this.stopTakeObservation();
      this.currentPhase = "reconciling";
      this.reconciliationRequired = true;
      await this.recordSafely("cash.present.executionUnknown", "device", "unknown");
      throw error;
    }
  }

  public async waitForTake(): Promise<CashDeliveryTerminalResult> {
    this.requireForegroundOwnership();
    this.requirePhase("awaitingTake");
    const deadline = Date.now() + this.options.presentationPolicy.takeTimeoutMs;
    while (Date.now() < deadline) {
      if (this.takeEventObserved) {
        return this.confirmTake("itemsTakenEvent");
      }
      const status = await readWithRetry(() =>
        this.options.client.getStatus(this.sessionRequest()), 2);
      assertXfsOk(status, "cdm.getStatus", this.metadata());
      const output = status.positions?.find(
        ({ fwPosition }) => fwPosition === this.outputPosition(),
      );
      if (output?.fwPositionStatus === WFS_CDM_PSEMPTY) {
        return this.confirmTake(output.fwPositionStatus);
      }
      await delay(this.options.policy.statusPollMs ?? 100);
    }
    await this.recordSafely("cash.take.timeout", "flow", "observed", undefined, "timeout");
    return this.retract("timeout");
  }

  public async abort(
    trigger: "cancel" | "timeout" | "interrupt" | "routeExit" | "runtimeShutdown",
  ): Promise<CashDeliveryTerminalResult> {
    this.requireForegroundOwnership();
    if (this.terminal) return this.terminal;
    if (this.movementPossible) {
      await this.recordSafely("cash.abort.requested", "flow", "observed", undefined, trigger);
    } else {
      await this.record("cash.abort.requested", "flow", "observed", undefined, trigger);
    }
    if (!this.movementPossible) return this.finish("notDispensed");
    return this.retract(trigger);
  }

  public async exit(
    trigger: NonNullable<CashOperationEvidence["trigger"]>,
  ): Promise<CashDeliveryExitResult> {
    this.requireForegroundOwnership();
    if (this.terminal) return { result: this.terminal, status: "terminal" };
    if (!this.movementPossible) {
      return { result: await this.abort(trigger), status: "terminal" };
    }
    const transfer = this.options.dependencies.recoveryTransfer;
    if (!transfer) {
      throw cashError(
        "cash.recoveryTransfer.unavailable",
        "A non-terminal cash session cannot exit without a Recovery Supervisor.",
      );
    }
    await this.recordSafely("cash.abort.requested", "flow", "observed", undefined, trigger);
    await this.updateRecovery();
    const receipt = await transfer.acceptTransfer({
      evidenceSequence: this.sequence,
      hostCommandLease: this.options.resources.hostCommandLease,
      lease: this.options.resources.recoveryLease,
      phase: this.currentPhase,
      releaseForegroundResources: () => this.options.resources.deviceLease.release(),
      trigger,
    });
    this.recoveryTransferred = true;
    return { receipt, status: "transferred" };
  }

  private async retract(
    trigger: NonNullable<CashOperationEvidence["trigger"]>,
  ): Promise<CashDeliveryTerminalResult> {
    if (this.retractDispatched) return this.finish("custodyUnknown");
    this.retractDispatched = true;
    this.currentPhase = "retracting";
    await this.recordSafely("cash.retract.intent", "flow", "observed", undefined, trigger);
    try {
      const result = await this.options.client.retract({
        retract: {
          index: this.options.policy.retractIndex ?? 0,
          outputPosition: this.options.policy.outputPosition ?? 2,
          retractArea: this.options.policy.retractArea ?? 1,
        },
        sessionId: this.options.session.id,
        timeoutMs: this.options.timeoutMs,
      });
      assertXfsOk(result, "cdm.retract", this.metadata());
      await this.recordSafely("cash.retract.completed", "device", "deviceReported", hResultOf(result));
      return this.finish("retracted");
    } catch (error) {
      this.reconciliationRequired = true;
      await this.recordSafely("cash.retract.executionUnknown", "device", "unknown");
      return this.finish("custodyUnknown");
    }
  }

  private async finish(outcome: CashCustodyOutcome): Promise<CashDeliveryTerminalResult> {
    if (this.terminal) return this.terminal;
    this.stopTakeObservation();
    let after: CashInventorySnapshot | undefined;
    try {
      after = await captureSnapshot(
        this.options,
        this.options.operationId,
        this.options.cashSessionId,
        "after",
        this.newId(),
      );
      await this.options.dependencies.evidence.recordAfterSnapshot(after);
    } catch {
      this.reconciliationRequired = true;
      await this.recordSafely("cash.afterSnapshot.failed", "device", "unknown");
    }
    this.currentPhase = "terminal";
    await this.recordSafely("cash.custody.terminal", "device", "observed", outcome);
    await releaseResources(this.options, this.options.resources, outcome);
    this.terminal = {
      after,
      outcome,
      reconciliationRequired: this.reconciliationRequired,
      safeSummary: {
        cashSessionId: this.options.cashSessionId,
        outcome,
        reconciliationRequired: this.reconciliationRequired,
      },
    };
    return this.terminal;
  }

  private validatePlan(plan: CashDispensePlan): void {
    const invalid = this.planConsumed || plan.id !== this.options.plan.id ||
      plan.operationId !== this.options.operationId || plan.cashSessionId !== this.id ||
      plan.logicalService !== this.options.logicalName ||
      plan.sessionGeneration !== this.options.sessionGeneration ||
      plan.cashUnitRevision !== this.options.before.revision ||
      plan.policyVersion !== this.options.policy.policyVersion || plan.expiresAt <= Date.now();
    if (invalid) throw cashError("cash.dispensePlan.invalid", "Cash dispense plan is stale, reused, or mismatched.");
  }

  private validateAuthorization(authorization: CashPresentationAuthorization): void {
    const required = this.options.presentationPolicy.requiredGates;
    const invalid = this.consumedAuthorizations.has(authorization.id) ||
      authorization.operationId !== this.options.operationId ||
      authorization.cashSessionId !== this.id ||
      authorization.policyId !== this.options.presentationPolicy.id ||
      authorization.policyVersion !== this.options.presentationPolicy.version ||
      authorization.expiresAt <= Date.now() ||
      required.some((gate) => !authorization.satisfiedGates.includes(gate));
    if (invalid) throw cashError("cash.presentationAuthorization.invalid", "Cash presentation authorization is invalid.");
  }

  private requirePhase(expected: CashDeliveryPhase): void {
    if (this.currentPhase !== expected) {
      throw cashError("cash.session.phase", `Cash session requires phase ${expected}.`);
    }
  }

  private async record(
    kind: string,
    source: CashOperationEvidence["source"],
    certainty: CashOperationEvidence["certainty"],
    safeResultCode?: string | number,
    trigger?: CashOperationEvidence["trigger"],
  ): Promise<void> {
    const evidence = this.nextEvidence(kind, source, certainty, safeResultCode, trigger);
    await this.options.dependencies.evidence.append(evidence);
  }

  private async recordSafely(
    kind: string,
    source: CashOperationEvidence["source"],
    certainty: CashOperationEvidence["certainty"],
    safeResultCode?: string | number,
    trigger?: CashOperationEvidence["trigger"],
  ): Promise<void> {
    const evidence = this.nextEvidence(kind, source, certainty, safeResultCode, trigger);
    try {
      await this.options.dependencies.evidence.append(evidence);
    } catch {
      this.reconciliationRequired = true;
      await this.options.dependencies.emergencySpool.append(evidence).catch(() => undefined);
    }
  }

  private nextEvidence(
    kind: string,
    source: CashOperationEvidence["source"],
    certainty: CashOperationEvidence["certainty"],
    safeResultCode?: string | number,
    trigger?: CashOperationEvidence["trigger"],
  ): CashOperationEvidence {
    this.sequence += 1;
    return evidenceRecord(this.options.dependencies, {
      cashSessionId: this.id,
      certainty,
      kind,
      operationId: this.options.operationId,
      phase: this.currentPhase,
      sequence: this.sequence,
      source,
      ...(safeResultCode !== undefined ? { safeResultCode } : {}),
      ...(trigger !== undefined ? { trigger } : {}),
    });
  }

  private async updateRecovery(): Promise<void> {
    await this.options.dependencies.recoveryLeases.update(
      this.options.resources.recoveryLease,
      this.currentPhase,
      this.sequence,
    );
  }

  private requireForegroundOwnership(): void {
    if (this.recoveryTransferred) {
      throw cashError(
        "cash.recoveryTransfer.foregroundOwnerStale",
        "Foreground cash-session ownership has already transferred to recovery.",
      );
    }
  }

  private positionRequest() {
    return {
      position: this.outputPosition(),
      sessionId: this.options.session.id,
      timeoutMs: this.options.timeoutMs,
    };
  }

  private sessionRequest() {
    return {
      sessionId: this.options.session.id,
      timeoutMs: this.options.timeoutMs,
    };
  }

  private outputPosition(): number {
    return this.options.policy.outputPosition ?? 2;
  }

  private startTakeObservation(): void {
    if (!this.options.client.subscribeEvent || this.takeSubscription) return;
    try {
      this.takeSubscription = this.options.client.subscribeEvent((event) => {
        if (
          event.data?.kind === "itemsTaken" &&
          eventPosition(event.data.value) === this.outputPosition()
        ) {
          this.takeEventObserved = true;
        }
      });
    } catch {
      this.takeSubscription = undefined;
    }
  }

  private stopTakeObservation(): void {
    this.takeSubscription?.unsubscribe();
    this.takeSubscription = undefined;
  }

  private async confirmTake(resultCode: string | number): Promise<CashDeliveryTerminalResult> {
    await this.recordSafely(
      "cash.take.confirmed",
      "device",
      "observed",
      resultCode,
    );
    return this.finish("taken");
  }

  private metadata(): Record<string, unknown> {
    return { cashSessionId: this.id, logicalName: this.options.logicalName, operationId: this.options.operationId };
  }

  private newId(): string {
    return this.options.dependencies.idFactory?.() ?? defaultId();
  }
}

function eventPosition(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || !("position" in value)) {
    return undefined;
  }

  const position = (value as { readonly position?: unknown }).position;
  return typeof position === "number" ? position : undefined;
}

const captureSnapshot = async (
  options: CashDeliveryPortOptions,
  operationId: string,
  cashSessionId: string,
  boundary: CashInventorySnapshot["boundary"],
  id: string,
): Promise<CashInventorySnapshot> => {
  const result = await readWithRetry(() => options.client.getCashUnitInfo({
    sessionId: options.session.id,
    timeoutMs: options.timeoutMs,
  }), 2);
  assertXfsOk(result, "cdm.getCashUnitInfo", { logicalName: options.logicalName });
  const units = (result.cashUnits ?? []).map((unit) => ({
    cashUnitRevision: undefined,
    count: unit.count,
    currency: unit.currencyId,
    denominationMinorUnits: unit.values,
    dispensedCount: unit.dispensedCount,
    logicalSlot: unit.number,
    physicalCassetteId: unit.unitId || undefined,
    physicalPosition: unit.physical[0]?.physicalPositionName,
    presentedCount: unit.presentedCount,
    rejectCount: unit.rejectCount,
    retractedCount: unit.retractedCount,
    status: unit.status,
    type: unit.cashUnitType,
  })).map(({ cashUnitRevision: _, ...unit }) => unit);
  return Object.freeze({
    boundary,
    capturedAt: (options.dependencies.now?.() ?? new Date()).toISOString(),
    cashSessionId,
    certainty: "observed",
    id,
    logicalService: options.logicalName,
    operationId,
    revision: revisionOf(options.policy.configurationRevision, units),
    source: "device",
    units,
  });
};

const releaseResources = async (
  options: CashDeliveryPortOptions,
  resources: HeldCashSessionResources,
  outcome: CashCustodyOutcome,
): Promise<void> => {
  await Promise.allSettled([
    options.dependencies.recoveryLeases.close(resources.recoveryLease, outcome),
    options.commandLeases.release(resources.hostCommandLease),
    resources.deviceLease.release(),
  ]);
};

const evidenceRecord = (
  dependencies: CashDeliveryDependencies,
  input: Omit<CashOperationEvidence, "wallTime" | "monotonicTime">,
): CashOperationEvidence => ({
  ...input,
  monotonicTime: dependencies.monotonicNow?.() ?? performance.now(),
  wallTime: (dependencies.now?.() ?? new Date()).toISOString(),
});

const validateAmount = (amount: CashAmount): void => {
  if (!amount.currency || !Number.isSafeInteger(amount.minorUnits) || amount.minorUnits <= 0) {
    throw cashError("cash.amount.invalid", "Cash amount must use positive integer minor units.");
  }
};

const safeSnapshotProjection = (snapshot: CashInventorySnapshot) => ({
  boundary: snapshot.boundary,
  cashSessionId: snapshot.cashSessionId,
  logicalService: snapshot.logicalService,
  revision: snapshot.revision,
  unitCount: snapshot.units.length,
});

const revisionOf = (configurationRevision: string, units: readonly unknown[]): string => {
  const identities = units.map((value) => {
    const unit = value as Record<string, unknown>;
    return [
      unit.logicalSlot,
      unit.physicalCassetteId,
      unit.physicalPosition,
      unit.type,
      unit.currency,
      unit.denominationMinorUnits,
    ];
  });
  const input = JSON.stringify([configurationRevision, identities]);
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${configurationRevision}:${(hash >>> 0).toString(16)}`;
};

const readWithRetry = async <T>(operation: () => Promise<T>, attempts: number): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await operation(); } catch (error) { lastError = error; }
  }
  throw lastError;
};

const cashError = (code: string, message: string): FrameworkError =>
  new FrameworkError({ category: "dependency", code, message });

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const WFS_CDM_PSEMPTY = 0;

const defaultId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `cash-${Date.now()}-${Math.random()}`;
