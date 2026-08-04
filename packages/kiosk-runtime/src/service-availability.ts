import { FrameworkError } from "@tripley-kit/web-container-errors";

export type ServiceAvailabilityStatus =
  | "starting"
  | "available"
  | "suspensionPending"
  | "outOfService";

export interface ServiceAvailabilityReason {
  readonly code: string;
  readonly safeData?: Readonly<Record<string, string | number | boolean | null>>;
}

export type ServiceAvailabilityGateResult =
  | {
      readonly available: true;
      readonly safeData?: Readonly<Record<string, string | number | boolean | null>>;
    }
  | {
      readonly available: false;
      readonly reason: ServiceAvailabilityReason;
    };

export interface ServiceAvailabilityGate {
  readonly id: string;
  evaluate(context: { readonly signal: AbortSignal }): Promise<ServiceAvailabilityGateResult>;
}

export interface ServiceAvailabilitySnapshot {
  readonly revision: number;
  readonly status: ServiceAvailabilityStatus;
  readonly reason?: ServiceAvailabilityReason;
  readonly activeOperationCount: number;
}

export interface ServiceAvailabilityAuditEvent {
  readonly eventId: string;
  readonly message: string;
  readonly status: ServiceAvailabilityStatus;
  readonly reasonCode?: string;
  readonly safeData?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ServiceAvailabilityAuditPort {
  append(event: ServiceAvailabilityAuditEvent): Promise<void>;
}

export interface ServiceAvailabilityScheduler {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface ServiceAvailabilityCoordinatorOptions {
  readonly gates?: readonly ServiceAvailabilityGate[];
  readonly retryIntervalMs?: number;
  readonly audit?: ServiceAvailabilityAuditPort;
  readonly scheduler?: ServiceAvailabilityScheduler;
}

export interface ServiceOperationLease {
  release(): Promise<void>;
}

export class ServiceAvailabilityCoordinator {
  private readonly abortController = new AbortController();
  private readonly gates: readonly ServiceAvailabilityGate[];
  private readonly listeners = new Set<(snapshot: ServiceAvailabilitySnapshot) => void>();
  private readonly retryIntervalMs: number;
  private readonly scheduler: ServiceAvailabilityScheduler;
  private activeOperationCount = 0;
  private disposed = false;
  private evaluation: Promise<ServiceAvailabilitySnapshot> | undefined;
  private initialized = false;
  private pendingReason: ServiceAvailabilityReason | undefined;
  private retryHandle: unknown;
  private state: ServiceAvailabilitySnapshot = {
    activeOperationCount: 0,
    revision: 0,
    status: "starting",
  };

  public constructor(private readonly options: ServiceAvailabilityCoordinatorOptions = {}) {
    this.gates = options.gates ?? [];
    this.retryIntervalMs = options.retryIntervalMs ?? 180_000;
    if (!Number.isSafeInteger(this.retryIntervalMs) || this.retryIntervalMs <= 0) {
      throw new Error("Service availability retryIntervalMs must be a positive integer.");
    }
    this.scheduler = options.scheduler ?? systemScheduler;
  }

  public snapshot(): ServiceAvailabilitySnapshot {
    return this.state;
  }

  public subscribe(listener: (snapshot: ServiceAvailabilitySnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  public async initialize(): Promise<ServiceAvailabilitySnapshot> {
    if (this.initialized) return this.evaluation ?? this.state;
    this.initialized = true;
    return this.evaluateGates();
  }

  public async retryNow(): Promise<ServiceAvailabilitySnapshot> {
    this.clearRetry();
    return this.evaluateGates();
  }

  public beginOperation(): ServiceOperationLease {
    if (this.state.status !== "available") {
      throw new FrameworkError({
        category: "dependency",
        code: "serviceAvailability.operationBlocked",
        message: "Customer operations are blocked while the kiosk is unavailable.",
        metadata: { status: this.state.status },
      });
    }
    this.activeOperationCount += 1;
    this.publish({ status: "available" });
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        await this.releaseOperation();
      },
    };
  }

  public async requestSuspension(reason: ServiceAvailabilityReason): Promise<void> {
    assertReason(reason);
    if (this.activeOperationCount > 0) {
      this.pendingReason ??= reason;
      this.publish({ reason: this.pendingReason, status: "suspensionPending" });
      await this.options.audit?.append({
        eventId: "serviceAvailability.suspensionPending",
        message: `Service suspension pending, reason: ${this.pendingReason.code}`,
        reasonCode: this.pendingReason.code,
        ...(this.pendingReason.safeData ? { safeData: this.pendingReason.safeData } : {}),
        status: "suspensionPending",
      });
      return;
    }
    await this.enterOutOfService(reason);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort("service availability disposed");
    this.clearRetry();
    this.listeners.clear();
  }

  private async evaluateGates(): Promise<ServiceAvailabilitySnapshot> {
    if (this.disposed) return this.state;
    if (this.evaluation) return this.evaluation;
    const evaluation = this.runGateEvaluation();
    this.evaluation = evaluation;
    try {
      return await evaluation;
    } finally {
      if (this.evaluation === evaluation) this.evaluation = undefined;
    }
  }

  private async runGateEvaluation(): Promise<ServiceAvailabilitySnapshot> {
    for (const gate of this.gates) {
      let result: ServiceAvailabilityGateResult;
      try {
        result = await gate.evaluate({ signal: this.abortController.signal });
      } catch {
        result = {
          available: false,
          reason: {
            code: "serviceAvailability.gateFailed",
            safeData: { gateId: gate.id },
          },
        };
      }
      if (!result.available) {
        await this.enterOutOfService(result.reason);
        this.scheduleRetry();
        return this.state;
      }
    }
    this.pendingReason = undefined;
    const changed = this.state.status !== "available";
    this.publish({ status: "available" });
    if (changed) {
      await this.options.audit?.append({
        eventId: "serviceAvailability.available",
        message: "Kiosk service is available.",
        status: "available",
      });
    }
    return this.state;
  }

  private async releaseOperation(): Promise<void> {
    this.activeOperationCount = Math.max(0, this.activeOperationCount - 1);
    if (this.activeOperationCount === 0 && this.pendingReason) {
      const reason = this.pendingReason;
      this.pendingReason = undefined;
      await this.enterOutOfService(reason);
      return;
    }
    this.publish({
      status: this.state.status,
      ...(this.pendingReason ? { reason: this.pendingReason } : {}),
    });
  }

  private async enterOutOfService(reason: ServiceAvailabilityReason): Promise<void> {
    const changed =
      this.state.status !== "outOfService" || this.state.reason?.code !== reason.code;
    this.publish({ reason, status: "outOfService" });
    if (changed) {
      await this.options.audit?.append({
        eventId: "serviceAvailability.outOfService",
        message: `Out of service, reason: ${reason.code}`,
        reasonCode: reason.code,
        ...(reason.safeData ? { safeData: reason.safeData } : {}),
        status: "outOfService",
      });
    }
  }

  private publish(input: {
    readonly status: ServiceAvailabilityStatus;
    readonly reason?: ServiceAvailabilityReason;
  }): void {
    this.state = {
      activeOperationCount: this.activeOperationCount,
      revision: this.state.revision + 1,
      status: input.status,
      ...(input.reason ? { reason: input.reason } : {}),
    };
    for (const listener of this.listeners) listener(this.state);
  }

  private scheduleRetry(): void {
    if (this.disposed || this.retryHandle !== undefined) return;
    this.retryHandle = this.scheduler.schedule(() => {
      this.retryHandle = undefined;
      void this.retryNow();
    }, this.retryIntervalMs);
  }

  private clearRetry(): void {
    if (this.retryHandle === undefined) return;
    this.scheduler.cancel(this.retryHandle);
    this.retryHandle = undefined;
  }
}

export const createServiceAvailabilityCoordinator = (
  options: ServiceAvailabilityCoordinatorOptions = {},
): ServiceAvailabilityCoordinator => new ServiceAvailabilityCoordinator(options);

const assertReason = (reason: ServiceAvailabilityReason): void => {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(reason.code)) {
    throw new Error("Service availability reason code is invalid.");
  }
};

const systemScheduler: ServiceAvailabilityScheduler = {
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
};
