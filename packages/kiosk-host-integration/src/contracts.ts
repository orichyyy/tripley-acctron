import type {
  HostFieldSet,
  HostMessageReference,
  HostMessageService,
} from "@tripley-kit/web-container-host-message";
import type {
  HostDeliveryRecord,
  HostTransportPort,
  SafeHostSummary,
} from "@tripley-kit/web-container-kiosk-host-delivery";

export interface HostMessageBinding<TRequest = unknown, TResponse = unknown> {
  readonly id: string;
  readonly version: string;
  readonly messageType: string;
  readonly channel: string;
  readonly transportId: string;
  readonly deliveryPolicyId: string;
  readonly timeoutMs: number;
  readonly request: HostMessageReference;
  readonly response: HostMessageReference;
  projectRequest(input: TRequest): HostFieldSet;
  summarizeRequest(input: TRequest): SafeHostSummary;
  mapResponse(fields: HostFieldSet): TResponse;
}

export type AnyHostMessageBinding = HostMessageBinding<unknown, unknown>;

export interface HostWireExchangeRequest {
  readonly channel: string;
  readonly idempotencyKey: string;
  readonly payload: Uint8Array;
  readonly timeoutMs: number;
}

export type HostWireExchangeResult =
  | { readonly status: "response"; readonly responseId: string; readonly payload: Uint8Array }
  | { readonly status: "notSent"; readonly errorCode: string }
  | { readonly status: "unknown"; readonly errorCode: string };

export interface HostWireTransportAdapter {
  readonly id: string;
  exchange(request: HostWireExchangeRequest): Promise<HostWireExchangeResult>;
}

export interface DurableHostEnqueueInput {
  readonly id: string;
  readonly transactionId: string;
  readonly messageId: string;
  readonly idempotencyKey: string;
  readonly messageType: string;
  readonly channel: string;
  readonly payload: Uint8Array;
  readonly safeSummary: SafeHostSummary;
  readonly policyId: string;
}

export interface DurableHostResponse {
  readonly responseId: string;
  readonly outboxId: string;
  readonly payloadRef: string;
  readonly payload: Uint8Array;
  readonly safeSummary: SafeHostSummary;
  readonly source: "transport" | "inquiry";
  readonly createdAt: string;
}

export interface DurableHostDeliveryBridge {
  enqueue(input: DurableHostEnqueueInput): Promise<HostDeliveryRecord>;
  get(outboxId: string): Promise<HostDeliveryRecord | undefined>;
  dispatch(outboxId: string): Promise<void>;
  readResponse(outboxId: string): Promise<DurableHostResponse | undefined>;
}

export interface HostMessageExchangeOptions {
  readonly bindings: import("./binding-registry").HostMessageBindingRegistry;
  readonly delivery: DurableHostDeliveryBridge;
  readonly messages: HostMessageService;
}

export interface HostMessageTransportOptions {
  readonly bindings: import("./binding-registry").HostMessageBindingRegistry;
  readonly messages: HostMessageService;
  readonly transports: import("./transport-registry").HostWireTransportRegistry;
}

export interface HostDeliveryRuntimeLike {
  readonly deliveries: {
    get(outboxId: string): Promise<HostDeliveryRecord | undefined>;
  };
  readonly queue: {
    enqueue(input: DurableHostEnqueueInput): Promise<HostDeliveryRecord>;
  };
  readonly responses: {
    read(outboxId: string): Promise<DurableHostResponse | undefined>;
  };
  readonly worker: {
    runOnce(outboxId?: string): Promise<unknown>;
  };
}

export type DurableHostTransport = HostTransportPort;
