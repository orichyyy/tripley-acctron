import type { HostDeliveryRecord, SafeHostSummary } from "./contracts";

export interface HostOutboxRow {
  readonly id: string;
  readonly transaction_id: string;
  readonly message_id: string;
  readonly idempotency_key: string;
  readonly message_type: string;
  readonly channel: string;
  readonly payload_ref: string;
  readonly safe_summary_json: string;
  readonly policy_id: string;
  readonly policy_version: string;
  readonly status: HostDeliveryRecord["status"];
  readonly attempt_count: number;
  readonly next_attempt_at: string | null;
  readonly lease_owner: string | null;
  readonly lease_until: string | null;
  readonly last_error_code: string | null;
  readonly response_id: string | null;
  readonly resolution: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export const mapHostOutbox = (row: HostOutboxRow): HostDeliveryRecord => ({
  id: row.id,
  transactionId: row.transaction_id,
  messageId: row.message_id,
  idempotencyKey: row.idempotency_key,
  messageType: row.message_type,
  channel: row.channel,
  payloadRef: row.payload_ref,
  safeSummary: JSON.parse(row.safe_summary_json) as SafeHostSummary,
  policyId: row.policy_id,
  policyVersion: row.policy_version,
  status: row.status,
  attemptCount: row.attempt_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(row.next_attempt_at === null ? {} : { nextAttemptAt: row.next_attempt_at }),
  ...(row.lease_owner === null ? {} : { leaseOwner: row.lease_owner }),
  ...(row.lease_until === null ? {} : { leaseUntil: row.lease_until }),
  ...(row.last_error_code === null ? {} : { lastErrorCode: row.last_error_code }),
  ...(row.response_id === null ? {} : { responseId: row.response_id }),
  ...(row.resolution === null ? {} : { resolution: row.resolution }),
});
