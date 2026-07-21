export type HostDeliveryStatus =
  | "pending"
  | "leased"
  | "retryScheduled"
  | "uncertain"
  | "reconciled"
  | "failed"
  | "cancelled";

export type SafeHostSummary = Readonly<Record<string, string | number | boolean>>;

export interface HostDeliveryRecord {
  readonly id: string;
  readonly transactionId: string;
  readonly messageId: string;
  readonly idempotencyKey: string;
  readonly messageType: string;
  readonly channel: string;
  readonly payloadRef: string;
  readonly safeSummary: SafeHostSummary;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly status: HostDeliveryStatus;
  readonly attemptCount: number;
  readonly nextAttemptAt?: string | undefined;
  readonly leaseOwner?: string | undefined;
  readonly leaseUntil?: string | undefined;
  readonly lastErrorCode?: string | undefined;
  readonly responseId?: string | undefined;
  readonly resolution?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EnqueueHostDeliveryInput {
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

export interface HostDeliveryPolicy {
  readonly id: string;
  readonly version: string;
  readonly leaseMs: number;
  readonly maxAttempts: number;
  readonly retryDelaysMs: readonly number[];
  readonly uncertainStrategy: "inquiry" | "manual";
  readonly inquiryNotFound: "retry" | "manual";
}

export type HostTransportResult =
  | {
      readonly status: "response";
      readonly responseId: string;
      readonly payload: Uint8Array;
      readonly safeSummary: SafeHostSummary;
    }
  | {
      readonly status: "notSent";
      readonly errorCode: string;
    }
  | {
      readonly status: "unknown";
      readonly errorCode: string;
    };

export interface HostTransportPort {
  send(request: {
    readonly outboxId: string;
    readonly transactionId: string;
    readonly messageId: string;
    readonly idempotencyKey: string;
    readonly messageType: string;
    readonly channel: string;
    readonly payload: Uint8Array;
  }): Promise<HostTransportResult>;
}

export interface HostInquiryPort {
  inquire(request: {
    readonly outboxId: string;
    readonly transactionId: string;
    readonly messageId: string;
    readonly idempotencyKey: string;
    readonly messageType: string;
    readonly safeSummary: SafeHostSummary;
  }): Promise<
    | { readonly status: "found"; readonly responseId: string; readonly payload: Uint8Array; readonly safeSummary: SafeHostSummary }
    | { readonly status: "notFound" }
    | { readonly status: "unavailable"; readonly errorCode: string }
  >;
}

export interface HostPayloadCipherPort {
  encrypt(payload: Uint8Array, context: { readonly payloadRef: string }): Promise<string>;
  decrypt(ciphertext: string, context: { readonly payloadRef: string }): Promise<Uint8Array>;
}

export interface HostPayloadVault {
  put(payloadRef: string, payload: Uint8Array): Promise<void>;
  get(payloadRef: string): Promise<Uint8Array | undefined>;
  delete(payloadRef: string): Promise<void>;
}

export interface HostDeliveryClock {
  now(): Date;
}

export const systemHostDeliveryClock: HostDeliveryClock = { now: () => new Date() };

export interface HostResponseInput {
  readonly outboxId: string;
  readonly responseId: string;
  readonly payload: Uint8Array;
  readonly safeSummary: SafeHostSummary;
  readonly source: "transport" | "inquiry";
}

export interface HostResponseProjectionResult {
  readonly status: "reconciled" | "duplicate" | "conflict";
  readonly outboxId: string;
}

export type ManualHostResolution = "confirmedDelivered" | "confirmedNotSent" | "cancelled";
