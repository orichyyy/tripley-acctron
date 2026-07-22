import type { HostWireExchangeRequest } from "@tripley-kit/web-container-kiosk-host-integration";

import type {
  HostSessionControlOperation,
  HostSessionControlResult,
  HostSessionScheduledTask,
  HostSessionSnapshot,
  HostSessionSubscription,
  HostSessionSupervisorEvent,
  HostSessionSupervisorOptions,
  HostSessionSupervisorPort,
  HostSessionSupervisorState,
  HostSessionTransportLifecycleEvent,
} from "./contracts";
import { type ControlOperationHandle, startControlOperation } from "./control-operation";
import { HostSessionLifecycleEmitter } from "./lifecycle";
import { systemHostSessionScheduler } from "./scheduler";
import { validateHostSessionOptions } from "./validation";

export class HostSessionSupervisor implements HostSessionSupervisorPort {
  public readonly id: string;

  private readonly scheduler;
  private readonly lifecycle = new HostSessionLifecycleEmitter();
  private transportSubscription?: HostSessionSubscription | undefined;
  private scheduledTask?: HostSessionScheduledTask | undefined;
  private control?: ControlOperationHandle | undefined;
  private activation?: Promise<void> | undefined;
  private running = false;
  private disposed = false;
  private stopping = false;
  private operationEpoch = 0;
  private establishAttempt = 0;
  private snapshotValue: HostSessionSnapshot;

  public constructor(private readonly options: HostSessionSupervisorOptions) {
    validateHostSessionOptions(options);
    this.id = options.id;
    this.scheduler = options.scheduler ?? systemHostSessionScheduler;
    this.snapshotValue = this.createSnapshot("stopped", 0, 0);
  }

  public get snapshot(): HostSessionSnapshot {
    return this.snapshotValue;
  }

  public onEvent(handler: (event: HostSessionSupervisorEvent) => void): HostSessionSubscription {
    return this.lifecycle.subscribe(handler);
  }

  public async start(): Promise<void> {
    if (this.disposed || this.stopping) throw new Error("host.session-supervisor.disposed");
    if (this.running) return this.activation;
    this.running = true;
    this.transportSubscription = this.options.transport.onLifecycle((event) =>
      this.handleTransportEvent(event),
    );
    this.transition("connecting");
    try {
      await this.options.transport.start();
    } catch {
      this.transition("disconnected", "host.session-supervisor.transport-start-failed");
      return;
    }
    if (this.options.transport.state === "connected") {
      this.activateGeneration(this.options.transport.generation);
    }
    await this.activation;
  }

  public async dispose(): Promise<void> {
    if (this.disposed || this.stopping) return;
    this.stopping = true;
    this.transition("stopping");
    this.invalidateWork();
    await this.tryShutdown();
    this.running = false;
    this.disposed = true;
    this.invalidateWork();
    await this.transportSubscription?.unsubscribe();
    this.transportSubscription = undefined;
    await this.options.transport.dispose();
    this.transition("stopped");
    this.emit({ type: "stopped" });
    this.lifecycle.clear();
  }

  private handleTransportEvent(event: HostSessionTransportLifecycleEvent): void {
    if (!this.running || this.disposed || this.stopping) return;
    if (event.type === "connected") {
      this.activateGeneration(event.generation);
      return;
    }
    if (event.type === "connecting") {
      this.transition("connecting");
      return;
    }
    if (event.type === "disconnected" || event.type === "disposed") {
      this.invalidateWork();
      this.transition("disconnected", event.errorCode ?? "host.session-supervisor.disconnected");
    }
  }

  private activateGeneration(generation: number): void {
    if (!this.running || generation <= 0) return;
    if (this.snapshot.generation === generation && this.activation) return;
    this.invalidateWork();
    this.establishAttempt = 0;
    this.snapshotValue = this.createSnapshot("establishing", generation, 0);
    this.emit({ type: "state-changed" });
    const activation = this.establish(generation);
    this.activation = activation;
    void activation.finally(() => {
      if (this.activation === activation) this.activation = undefined;
    });
  }

  private async establish(generation: number): Promise<void> {
    this.establishAttempt += 1;
    const result = await this.runControl(
      "establish",
      generation,
      this.options.policy.establishTimeoutMs,
      this.options.protocol.establish,
    );
    if (!result || !this.isCurrentGeneration(generation)) return;
    if (result.status === "accepted") {
      this.establishAttempt = 0;
      this.transition("ready", undefined, 0);
      this.scheduleHeartbeat(generation);
      return;
    }
    this.transition("degraded", result.errorCode);
    this.scheduleEstablishRetry(generation);
  }

  private scheduleEstablishRetry(generation: number): void {
    const retry = this.options.policy.establishRetry;
    const delayMs = Math.min(
      retry.maxDelayMs,
      retry.initialDelayMs * retry.multiplier ** Math.max(0, this.establishAttempt - 1),
    );
    this.emit({ attempt: this.establishAttempt, delayMs, type: "retry-scheduled" });
    this.schedule(delayMs, () => {
      if (!this.isCurrentGeneration(generation)) return;
      this.transition("establishing");
      this.activation = this.establish(generation);
    });
  }

  private scheduleHeartbeat(generation: number): void {
    const policy = this.options.policy.heartbeat;
    if (!policy || !this.options.protocol.heartbeat) return;
    this.schedule(policy.intervalMs, () => void this.heartbeat(generation));
  }

  private async heartbeat(generation: number): Promise<void> {
    const policy = this.options.policy.heartbeat;
    const hook = this.options.protocol.heartbeat;
    if (!policy || !hook || !this.isCurrentGeneration(generation)) return;
    const result = await this.runControl("heartbeat", generation, policy.timeoutMs, hook);
    if (!result || !this.isCurrentGeneration(generation)) return;
    if (result.status === "accepted") {
      this.transition("ready", undefined, 0);
      this.scheduleHeartbeat(generation);
      return;
    }
    const failures = this.snapshot.consecutiveHeartbeatFailures + 1;
    if (failures < policy.failureThreshold) {
      this.transition("ready", result.errorCode, failures);
      this.scheduleHeartbeat(generation);
      return;
    }
    this.transition("degraded", result.errorCode, failures);
    this.establishAttempt = 0;
    this.scheduleEstablishRetry(generation);
  }

  private async runControl(
    operation: HostSessionControlOperation,
    generation: number,
    timeoutMs: number,
    hook: NonNullable<
      | HostSessionSupervisorOptions["protocol"]["establish"]
      | HostSessionSupervisorOptions["protocol"]["heartbeat"]
      | HostSessionSupervisorOptions["protocol"]["shutdown"]
    >,
  ): Promise<HostSessionControlResult | undefined> {
    const epoch = ++this.operationEpoch;
    this.control?.cancel();
    this.emit({ operation, type: "control-started" });
    const control = startControlOperation(
      this.scheduler,
      timeoutMs,
      {
        exchange: (request) => this.exchangeForGeneration(generation, request),
        generation,
        sessionId: this.id,
      },
      hook,
    );
    this.control = control;
    const result = await control.result;
    if (this.control === control) this.control = undefined;
    if (epoch !== this.operationEpoch || !this.isCurrentGeneration(generation)) return undefined;
    if (result.status === "accepted") this.emit({ operation, type: "control-succeeded" });
    else this.emit({ operation, reasonCode: result.errorCode, type: "control-failed" });
    return result;
  }

  private exchangeForGeneration(generation: number, request: HostWireExchangeRequest) {
    if (!this.isCurrentGeneration(generation)) {
      return Promise.resolve({
        status: "notSent" as const,
        errorCode: "host.session-supervisor.stale-generation",
      });
    }
    return this.options.transport.exchange(request);
  }

  private async tryShutdown(): Promise<void> {
    const hook = this.options.protocol.shutdown;
    const generation = this.snapshot.generation;
    if (!hook || generation <= 0 || this.options.transport.state !== "connected") return;
    await this.runControl(
      "shutdown",
      generation,
      this.options.policy.shutdownTimeoutMs ?? this.options.policy.establishTimeoutMs,
      hook,
    );
  }

  private schedule(delayMs: number, callback: () => void): void {
    this.scheduledTask?.cancel();
    this.scheduledTask = this.scheduler.schedule(delayMs, () => {
      this.scheduledTask = undefined;
      callback();
    });
  }

  private invalidateWork(): void {
    this.operationEpoch += 1;
    this.control?.cancel();
    this.control = undefined;
    this.scheduledTask?.cancel();
    this.scheduledTask = undefined;
    this.activation = undefined;
  }

  private isCurrentGeneration(generation: number): boolean {
    return (
      this.running &&
      !this.disposed &&
      generation === this.snapshot.generation &&
      generation === this.options.transport.generation &&
      this.options.transport.state === "connected"
    );
  }

  private transition(
    state: HostSessionSupervisorState,
    reasonCode?: string,
    failures = this.snapshot.consecutiveHeartbeatFailures,
  ): void {
    this.snapshotValue = this.createSnapshot(state, this.snapshot.generation, failures, reasonCode);
    this.emit({ reasonCode, type: "state-changed" });
  }

  private createSnapshot(
    state: HostSessionSupervisorState,
    generation: number,
    failures: number,
    reasonCode?: string,
  ): HostSessionSnapshot {
    return {
      available: state === "ready",
      changedAt: this.scheduler.now(),
      consecutiveHeartbeatFailures: failures,
      generation,
      id: this.id,
      reasonCode,
      state,
    };
  }

  private emit(
    event: Omit<HostSessionSupervisorEvent, "at" | "generation" | "sessionId" | "state">,
  ): void {
    this.lifecycle.emit({
      ...event,
      at: this.scheduler.now(),
      generation: this.snapshot.generation,
      sessionId: this.id,
      state: this.snapshot.state,
    });
  }
}
