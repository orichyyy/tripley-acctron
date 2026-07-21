import type {
  FrameworkSqliteConnection,
  FrameworkSqliteTransaction,
} from "@tripley-kit/web-container-storage-core";

import type {
  HostDeliveryClock,
  HostDeliveryStatus,
  HostResponseInput,
  HostResponseProjectionResult,
  ManualHostResolution,
} from "./contracts";
import { systemHostDeliveryClock } from "./contracts";

interface ResponseRow {
  readonly response_id: string;
  readonly outbox_id: string;
  readonly payload_ref: string;
  readonly safe_summary_json: string;
  readonly source: HostResponseInput["source"];
  readonly created_at: string;
}

export interface StoredHostResponse {
  readonly responseId: string;
  readonly outboxId: string;
  readonly payloadRef: string;
  readonly safeSummary: HostResponseInput["safeSummary"];
  readonly source: HostResponseInput["source"];
  readonly createdAt: string;
}

interface OutboxProjectionRow {
  readonly id: string;
  readonly transaction_id: string;
  readonly message_type: string;
  readonly channel: string;
  readonly status: HostDeliveryStatus;
}

export class SqliteHostReconciliationStore {
  public constructor(
    private readonly db: FrameworkSqliteConnection,
    private readonly clock: HostDeliveryClock = systemHostDeliveryClock,
  ) {}

  public async applyResponse(
    input: Omit<HostResponseInput, "payload"> & { readonly payloadRef: string },
  ): Promise<HostResponseProjectionResult> {
    return this.db.transaction(async (tx) => {
      const duplicate = await tx.queryOne<ResponseRow>(
        "SELECT outbox_id FROM kiosk_host_response WHERE response_id = ?",
        [input.responseId],
      );
      if (duplicate) {
        return {
          outboxId: input.outboxId,
          status: duplicate.outbox_id === input.outboxId ? "duplicate" : "conflict",
        };
      }
      const outbox = await requireOutbox(tx, input.outboxId);
      const now = this.clock.now().toISOString();
      await tx.run(
        `INSERT INTO kiosk_host_response
         (response_id, outbox_id, payload_ref, safe_summary_json, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          input.responseId,
          input.outboxId,
          input.payloadRef,
          JSON.stringify(input.safeSummary),
          input.source,
          now,
        ],
      );
      await appendInboundMessage(tx, outbox, input, now);
      await appendAudit(
        tx,
        {
          data: { responseId: input.responseId, source: input.source },
          eventId: "host.delivery.reconciled",
          id: `host-reconciliation:${input.responseId}`,
          message: "Host delivery response reconciled",
          transactionId: outbox.transaction_id,
        },
        now,
      );
      await tx.run(
        `UPDATE kiosk_host_outbox SET status = 'reconciled', response_id = ?, resolution = ?,
         lease_owner = NULL, lease_until = NULL, updated_at = ? WHERE id = ?`,
        [input.responseId, input.source, now, input.outboxId],
      );
      return { outboxId: input.outboxId, status: "reconciled" };
    });
  }

  public async getResponse(outboxId: string): Promise<StoredHostResponse | undefined> {
    const row = await this.db.queryOne<ResponseRow>(
      "SELECT * FROM kiosk_host_response WHERE outbox_id = ?",
      [outboxId],
    );
    if (!row) return undefined;
    return {
      createdAt: row.created_at,
      outboxId: row.outbox_id,
      payloadRef: row.payload_ref,
      responseId: row.response_id,
      safeSummary: JSON.parse(row.safe_summary_json) as HostResponseInput["safeSummary"],
      source: row.source,
    };
  }

  public async applyManualResolution(input: {
    readonly outboxId: string;
    readonly resolution: ManualHostResolution;
    readonly operatorId: string;
    readonly reasonCode: string;
    readonly retryAt?: string | undefined;
  }): Promise<void> {
    if (!input.operatorId.trim() || !input.reasonCode.trim()) {
      throw new Error("Manual host resolution requires operator and reason code");
    }
    await this.db.transaction(async (tx) => {
      const outbox = await requireOutbox(tx, input.outboxId);
      if (outbox.status !== "uncertain" && outbox.status !== "failed") {
        throw new Error(`Host delivery cannot be manually resolved from ${outbox.status}`);
      }
      const now = this.clock.now().toISOString();
      const status = manualStatus(input.resolution);
      if (status === "retryScheduled" && !input.retryAt) {
        throw new Error("Confirmed-not-sent resolution requires a retry time");
      }
      await tx.run(
        `UPDATE kiosk_host_outbox SET status = ?, resolution = ?, next_attempt_at = ?,
         lease_owner = NULL, lease_until = NULL, last_error_code = NULL, updated_at = ?
         WHERE id = ?`,
        [status, `manual:${input.resolution}`, input.retryAt ?? null, now, input.outboxId],
      );
      await appendAudit(
        tx,
        {
          data: {
            operatorId: input.operatorId,
            reasonCode: input.reasonCode,
            resolution: input.resolution,
          },
          eventId: "host.delivery.manual-resolution",
          id: `host-manual:${input.outboxId}:${now}`,
          message: "Host delivery manually resolved",
          transactionId: outbox.transaction_id,
        },
        now,
      );
    });
  }
}

const requireOutbox = async (
  tx: FrameworkSqliteTransaction,
  id: string,
): Promise<OutboxProjectionRow> => {
  const row = await tx.queryOne<OutboxProjectionRow>(
    "SELECT id, transaction_id, message_type, channel, status FROM kiosk_host_outbox WHERE id = ?",
    [id],
  );
  if (!row) throw new Error(`Host delivery record not found: ${id}`);
  return row;
};

const appendInboundMessage = async (
  tx: FrameworkSqliteTransaction,
  outbox: OutboxProjectionRow,
  input: Omit<HostResponseInput, "payload"> & { readonly payloadRef: string },
  now: string,
): Promise<void> => {
  const sequence = await tx.queryOne<{ readonly next_seq: number }>(
    "SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM kiosk_transaction_message WHERE transaction_id = ?",
    [outbox.transaction_id],
  );
  await tx.run(
    `INSERT INTO kiosk_transaction_message
     (id, transaction_id, seq, direction, message_type, channel, status,
      request_id, payload_json, created_at)
     VALUES (?, ?, ?, 'inbound', ?, ?, 'received', ?, ?, ?)`,
    [
      `host-response:${input.responseId}`,
      outbox.transaction_id,
      sequence?.next_seq ?? 1,
      `${outbox.message_type}.response`,
      outbox.channel,
      outbox.id,
      JSON.stringify(input.safeSummary),
      now,
    ],
  );
};

const appendAudit = async (
  tx: FrameworkSqliteTransaction,
  event: {
    readonly id: string;
    readonly eventId: string;
    readonly transactionId: string;
    readonly message: string;
    readonly data: Readonly<Record<string, string>>;
  },
  now: string,
): Promise<void> => {
  await tx.run(
    `INSERT INTO kiosk_audit_journal
     (id, event_id, transaction_id, message, data_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [event.id, event.eventId, event.transactionId, event.message, JSON.stringify(event.data), now],
  );
};

const manualStatus = (resolution: ManualHostResolution) => {
  if (resolution === "confirmedDelivered") return "reconciled" as const;
  if (resolution === "confirmedNotSent") return "retryScheduled" as const;
  return "cancelled" as const;
};
