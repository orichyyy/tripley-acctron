import type { FrameworkSqliteConnection } from "@tripley-kit/web-container-storage-core";
import type { JsonValue } from "@tripley-kit/web-container-types";

import type { Clock } from "./calendar";
import { systemClock } from "./calendar";
import type { Outbox, OutboxMessage } from "./outbox";

interface OutboxRow {
  readonly id: string;
  readonly topic: string;
  readonly payload_json: string;
  readonly status: OutboxMessage["status"];
  readonly created_at: string;
}

export class SqliteOutbox implements Outbox {
  public constructor(
    private readonly db: FrameworkSqliteConnection,
    private readonly clock: Clock = systemClock,
  ) {}

  public async enqueue(
    message: Omit<OutboxMessage, "createdAt" | "status">,
  ): Promise<OutboxMessage> {
    const record: OutboxMessage = {
      ...message,
      createdAt: this.clock.now().toISOString(),
      status: "pending",
    };
    await this.db.run(
      `INSERT INTO kiosk_outbox (id, topic, payload_json, status, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [record.id, record.topic, JSON.stringify(record.payload), record.status, record.createdAt],
    );
    return record;
  }

  public async listPending(): Promise<OutboxMessage[]> {
    const rows = await this.db.queryAll<OutboxRow>(
      "SELECT * FROM kiosk_outbox WHERE status = 'pending' ORDER BY created_at, id",
    );
    return rows.map((row) => ({
      createdAt: row.created_at,
      id: row.id,
      payload: JSON.parse(row.payload_json) as JsonValue,
      status: row.status,
      topic: row.topic,
    }));
  }

  public async markSent(id: string): Promise<void> {
    const result = await this.db.run(
      "UPDATE kiosk_outbox SET status = 'sent' WHERE id = ?",
      [id],
    );
    if (result.changes === 0) throw new Error(`Outbox message not found: ${id}`);
  }
}

