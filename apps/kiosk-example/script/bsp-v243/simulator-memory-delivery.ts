import type {
  DurableHostDeliveryBridge,
} from "@tripley-kit/web-container-kiosk-host-integration";
import type {
  HostDeliveryRecord,
  HostTransportPort,
} from "@tripley-kit/web-container-kiosk-host-delivery";

export const createMemoryHostDelivery = (
  transport: HostTransportPort,
): DurableHostDeliveryBridge => {
  const records = new Map<string, HostDeliveryRecord>();
  const payloads = new Map<string, Uint8Array>();
  const responses = new Map<string, {
    readonly responseId: string;
    readonly payload: Uint8Array;
    readonly safeSummary: Readonly<Record<string, string | number | boolean>>;
  }>();
  return {
    enqueue: async (input) => {
      const existing = records.get(input.id);
      if (existing) return existing;
      const { payload, ...metadata } = input;
      payloads.set(input.id, payload);
      const now = new Date().toISOString();
      const record: HostDeliveryRecord = {
        ...metadata,
        attemptCount: 0,
        createdAt: now,
        payloadRef: `${input.id}:request`,
        policyVersion: "1",
        status: "pending",
        updatedAt: now,
      };
      records.set(record.id, record);
      return record;
    },
    get: async (outboxId) => records.get(outboxId),
    dispatch: async (outboxId) => {
      const record = records.get(outboxId);
      if (!record || record.status === "reconciled") return;
      const payload = payloads.get(record.id);
      if (!payload) throw new Error(`Smoke delivery payload is missing: ${record.id}`);
      const result = await transport.send({
        channel: record.channel,
        idempotencyKey: record.idempotencyKey,
        messageId: record.messageId,
        messageType: record.messageType,
        outboxId,
        payload,
        transactionId: record.transactionId,
      });
      if (result.status !== "response") {
        records.set(outboxId, {
          ...record,
          lastErrorCode: result.errorCode,
          status: result.status === "unknown" ? "uncertain" : "retryScheduled",
        });
        return;
      }
      responses.set(outboxId, result);
      records.set(outboxId, {
        ...record,
        responseId: result.responseId,
        status: "reconciled",
      });
    },
    readResponse: async (outboxId) => {
      const response = responses.get(outboxId);
      return response
        ? {
            ...response,
            createdAt: new Date().toISOString(),
            outboxId,
            payloadRef: `${outboxId}:response`,
            source: "transport",
          }
        : undefined;
    },
  };
};
