import type {
  HostWireExchangeRequest,
  HostWireExchangeResult,
} from "@tripley-kit/web-container-kiosk-host-integration";

export type HostSessionSupervisorState =
  | "stopped"
  | "connecting"
  | "establishing"
  | "ready"
  | "degraded"
  | "disconnected"
  | "stopping";

export interface HostSessionSnapshot {
  readonly id: string;
  readonly state: HostSessionSupervisorState;
  readonly available: boolean;
  readonly generation: number;
  readonly changedAt: number;
  readonly consecutiveHeartbeatFailures: number;
  readonly reasonCode?: string | undefined;
}

export interface HostSessionTransportLifecycleEvent {
  readonly at: number;
  readonly generation: number;
  readonly state: string;
  readonly type:
    | "connecting"
    | "connected"
    | "disconnected"
    | "reconnect-scheduled"
    | "protocol-error"
    | "orphan-response"
    | "inbound-unhandled"
    | "inbound-failed"
    | "disposed";
  readonly errorCode?: string | undefined;
}

export interface HostSessionSubscription {
  unsubscribe(): void | Promise<void>;
}

export interface HostSessionTransportPort {
  readonly id: string;
  readonly generation: number;
  readonly state: string;
  start(): Promise<void>;
  exchange(request: HostWireExchangeRequest): Promise<HostWireExchangeResult>;
  onLifecycle(
    handler: (event: HostSessionTransportLifecycleEvent) => void,
  ): HostSessionSubscription;
  dispose(): Promise<void>;
}

export type HostSessionControlResult =
  | { readonly status: "accepted" }
  | { readonly status: "failed"; readonly errorCode: string };

export interface HostSessionControlContext {
  readonly sessionId: string;
  readonly generation: number;
  readonly signal: AbortSignal;
  exchange(request: HostWireExchangeRequest): Promise<HostWireExchangeResult>;
}

export interface HostSessionProtocol {
  establish(context: HostSessionControlContext): Promise<HostSessionControlResult>;
  heartbeat?(context: HostSessionControlContext): Promise<HostSessionControlResult>;
  shutdown?(context: HostSessionControlContext): Promise<HostSessionControlResult>;
}

export interface HostSessionRetryPolicy {
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly multiplier: number;
}

export interface HostSessionHeartbeatPolicy {
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly failureThreshold: number;
}

export interface HostSessionPolicy {
  readonly establishTimeoutMs: number;
  readonly establishRetry: HostSessionRetryPolicy;
  readonly heartbeat?: HostSessionHeartbeatPolicy | undefined;
  readonly shutdownTimeoutMs?: number | undefined;
}

export interface HostSessionScheduledTask {
  cancel(): void;
}

export interface HostSessionScheduler {
  now(): number;
  schedule(delayMs: number, callback: () => void): HostSessionScheduledTask;
}

export type HostSessionControlOperation = "establish" | "heartbeat" | "shutdown";

export interface HostSessionSupervisorEvent {
  readonly at: number;
  readonly sessionId: string;
  readonly generation: number;
  readonly state: HostSessionSupervisorState;
  readonly type:
    | "state-changed"
    | "control-started"
    | "control-succeeded"
    | "control-failed"
    | "retry-scheduled"
    | "stopped";
  readonly operation?: HostSessionControlOperation | undefined;
  readonly reasonCode?: string | undefined;
  readonly delayMs?: number | undefined;
  readonly attempt?: number | undefined;
}

export interface HostSessionSupervisorPort {
  readonly id: string;
  readonly snapshot: HostSessionSnapshot;
  start(): Promise<void>;
  dispose(): Promise<void>;
  onEvent(handler: (event: HostSessionSupervisorEvent) => void): HostSessionSubscription;
}

export interface HostSessionSupervisorOptions {
  readonly id: string;
  readonly transport: HostSessionTransportPort;
  readonly protocol: HostSessionProtocol;
  readonly policy: HostSessionPolicy;
  readonly scheduler?: HostSessionScheduler | undefined;
}
