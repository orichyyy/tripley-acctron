import type { FrameworkSqliteConnection } from "@tripley-kit/web-container-storage-core";

import type {
  HostDeliveryClock,
  HostDeliveryPolicy,
  HostDeliveryRecord,
  SafeHostSummary,
} from "./contracts";
import { systemHostDeliveryClock } from "./contracts";
import { mapHostOutbox, type HostOutboxRow } from "./sqlite-codec";

export interface NewHostDeliveryRecord {
  readonly id: string;
  readonly transactionId: string;
  readonly messageId: string;
  readonly idempotencyKey: string;
  readonly messageType: string;
  readonly channel: string;
  readonly payloadRef: string;
  readonly safeSummary: SafeHostSummary;
  readonly policy: HostDeliveryPolicy;
}

export class SqliteHostDeliveryStore {
  public constructor(
    private readonly db: FrameworkSqliteConnection,
    private readonly clock: HostDeliveryClock = systemHostDeliveryClock,
  ) {}

  public async enqueue(input: NewHostDeliveryRecord): Promise<HostDeliveryRecord> {
    return this.db.transaction(async (tx) => {
      const existing = await tx.queryOne<HostOutboxRow>(
        "SELECT * FROM kiosk_host_outbox WHERE idempotency_key = ?",
        [input.idempotencyKey],
      );
      if (existing) {
        if (existing.id !== input.id || existing.transaction_id !== input.transactionId) {
          throw new Error(`Host delivery idempotency conflict: ${input.idempotencyKey}`);
        }
        return mapHostOutbox(existing);
      }
      const now = this.clock.now().toISOString();
      await tx.run(
        `INSERT INTO kiosk_host_outbox
         (id, transaction_id, message_id, idempotency_key, message_type, channel,
          payload_ref, safe_summary_json, policy_id, policy_version, status,
          attempt_count, next_attempt_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
        [input.id, input.transactionId, input.messageId, input.idempotencyKey,
          input.messageType, input.channel, input.payloadRef, JSON.stringify(input.safeSummary),
          input.policy.id, input.policy.version, now, now, now],
      );
      const sequence = await tx.queryOne<{ readonly next_seq: number }>(
        "SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM kiosk_transaction_message WHERE transaction_id = ?",
        [input.transactionId],
      );
      await tx.run(
        `INSERT INTO kiosk_transaction_message
         (id, transaction_id, seq, direction, message_type, channel, status,
          request_id, payload_json, created_at)
         VALUES (?, ?, ?, 'outbound', ?, ?, 'queued', ?, ?, ?)`,
        [input.messageId, input.transactionId, sequence?.next_seq ?? 1, input.messageType,
          input.channel, input.id, JSON.stringify(input.safeSummary), now],
      );
      return (await this.getWith(tx, input.id))!;
    });
  }

  public get(id: string): Promise<HostDeliveryRecord | undefined> {
    return this.getWith(this.db, id);
  }

  public async claimNext(owner: string, policies: HostDeliveryPolicyRegistryLike): Promise<HostDeliveryRecord | undefined> {
    return this.db.transaction(async (tx) => {
      const now = this.clock.now();
      const iso = now.toISOString();
      await tx.run(
        `UPDATE kiosk_host_outbox SET status = 'uncertain', lease_owner = NULL,
         lease_until = NULL, last_error_code = 'host.delivery.lease-expired', updated_at = ?
         WHERE status = 'leased' AND lease_until <= ?`,
        [iso, iso],
      );
      const row = await tx.queryOne<HostOutboxRow>(
        `SELECT * FROM kiosk_host_outbox
         WHERE status IN ('pending', 'retryScheduled') AND next_attempt_at <= ?
         ORDER BY next_attempt_at, created_at, id LIMIT 1`,
        [iso],
      );
      if (!row) return undefined;
      const policy = policies.require(row.policy_id);
      if (policy.version !== row.policy_version) {
        await tx.run(
          `UPDATE kiosk_host_outbox SET status = 'uncertain',
           last_error_code = 'host.delivery.policy-version-mismatch', updated_at = ? WHERE id = ?`,
          [iso, row.id],
        );
        return undefined;
      }
      const leaseUntil = new Date(now.getTime() + policy.leaseMs).toISOString();
      const result = await tx.run(
        `UPDATE kiosk_host_outbox SET status = 'leased', attempt_count = attempt_count + 1,
         lease_owner = ?, lease_until = ?, updated_at = ?
         WHERE id = ? AND status IN ('pending', 'retryScheduled')`,
        [owner, leaseUntil, iso, row.id],
      );
      return result.changes === 0 ? undefined : this.getWith(tx, row.id);
    });
  }

  public scheduleRetry(id: string, nextAttemptAt: string, errorCode: string): Promise<void> {
    return this.updateState(id, "retryScheduled", errorCode, nextAttemptAt);
  }

  public markUncertain(id: string, errorCode: string): Promise<void> {
    return this.updateState(id, "uncertain", errorCode);
  }

  public markFailed(id: string, errorCode: string): Promise<void> {
    return this.updateState(id, "failed", errorCode);
  }

  private async updateState(
    id: string,
    status: HostDeliveryRecord["status"],
    errorCode: string,
    nextAttemptAt?: string,
  ): Promise<void> {
    const result = await this.db.run(
      `UPDATE kiosk_host_outbox SET status = ?, next_attempt_at = ?, lease_owner = NULL,
       lease_until = NULL, last_error_code = ?, updated_at = ? WHERE id = ?`,
      [status, nextAttemptAt ?? null, errorCode, this.clock.now().toISOString(), id],
    );
    if (result.changes === 0) throw new Error(`Host delivery record not found: ${id}`);
  }

  private async getWith(
    db: Pick<FrameworkSqliteConnection, "queryOne">,
    id: string,
  ): Promise<HostDeliveryRecord | undefined> {
    const row = await db.queryOne<HostOutboxRow>(
      "SELECT * FROM kiosk_host_outbox WHERE id = ?",
      [id],
    );
    return row ? mapHostOutbox(row) : undefined;
  }
}

export interface HostDeliveryPolicyRegistryLike {
  require(id: string): HostDeliveryPolicy;
}
