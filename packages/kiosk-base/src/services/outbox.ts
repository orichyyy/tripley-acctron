import type { JsonValue } from "@tripley-kit/web-container-types";

export interface OutboxMessage {
  readonly id: string;
  readonly topic: string;
  readonly payload: JsonValue;
  readonly status: "pending" | "sent" | "failed";
  readonly createdAt: string;
}

export interface Outbox {
  enqueue(message: Omit<OutboxMessage, "createdAt" | "status">): Promise<OutboxMessage>;
  listPending(): Promise<OutboxMessage[]>;
  markSent(id: string): Promise<void>;
}

export const kioskOutboxTableSql = `CREATE TABLE IF NOT EXISTS kiosk_outbox (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);`;
