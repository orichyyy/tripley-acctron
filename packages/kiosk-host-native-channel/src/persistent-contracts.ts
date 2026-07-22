import type {
  HostWireExchangeRequest,
  HostWireExchangeResult,
} from "@tripley-kit/web-container-kiosk-host-integration";

import type { NativeEventSubscription, NativeTcpSecurity } from "./contracts";
import type { HostFrameCodec } from "./framing";

export interface HostPendingExchangeMetadata {
  readonly channel: string;
  readonly idempotencyKey: string;
}

export type PersistentHostFrameRoute =
  | { readonly kind: "response"; readonly responseId?: string | undefined }
  | { readonly kind: "inbound"; readonly type: string; readonly messageId?: string | undefined }
  | { readonly kind: "ignore"; readonly reason: string };

export interface PersistentHostFrameRouteInput {
  readonly payload: Uint8Array;
  readonly pending?: HostPendingExchangeMetadata | undefined;
}

export interface HostInboundMessage {
  readonly generation: number;
  readonly messageId?: string | undefined;
  readonly payload: Uint8Array;
  readonly receivedAt: number;
  readonly type: string;
}

export type HostInboundReplyResult =
  | { readonly status: "sent" }
  | { readonly status: "notSent"; readonly errorCode: string }
  | { readonly status: "unknown"; readonly errorCode: string };

export interface HostInboundMessageContext {
  respond(payload: Uint8Array): Promise<HostInboundReplyResult>;
}

export interface HostInboundMessageHandler {
  readonly id: string;
  readonly type: string;
  handle(message: HostInboundMessage, context: HostInboundMessageContext): Promise<void> | void;
}

export type HostInboundDispatchResult =
  | { readonly status: "handled"; readonly handlerId: string }
  | { readonly status: "unhandled" }
  | { readonly status: "failed"; readonly handlerId: string; readonly errorCode: string };

export interface HostInboundMessageDispatcher {
  dispatch(
    message: HostInboundMessage,
    context: HostInboundMessageContext,
  ): Promise<HostInboundDispatchResult>;
}

export interface PersistentHostReconnectPolicy {
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly multiplier: number;
}

export interface PersistentNativeTcpHostSessionConfig {
  readonly id: string;
  readonly host: string;
  readonly port: number;
  readonly connectTimeoutMs: number;
  readonly writeTimeoutMs: number;
  readonly responseTimeoutMs: number;
  readonly frame: HostFrameCodec;
  readonly security: NativeTcpSecurity;
  readonly inbound: HostInboundMessageDispatcher;
  readonly reconnect: PersistentHostReconnectPolicy;
  routeFrame(input: PersistentHostFrameRouteInput): PersistentHostFrameRoute;
}

export type PersistentHostSessionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disposed";

export interface PersistentHostSessionLifecycleEvent {
  readonly at: number;
  readonly generation: number;
  readonly state: PersistentHostSessionState;
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
  readonly delayMs?: number | undefined;
  readonly errorCode?: string | undefined;
  readonly inboundType?: string | undefined;
}

export interface PersistentHostSessionPort {
  readonly id: string;
  readonly generation: number;
  readonly state: PersistentHostSessionState;
  start(): Promise<void>;
  onLifecycle(
    handler: (event: PersistentHostSessionLifecycleEvent) => void,
  ): NativeEventSubscription;
  exchange(request: HostWireExchangeRequest): Promise<HostWireExchangeResult>;
  dispose(): Promise<void>;
}
