import type { Migration } from "@tripley-kit/web-container-storage-core";

export const HOST_DELIVERY_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS kiosk_host_outbox (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  message_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  payload_ref TEXT NOT NULL UNIQUE,
  safe_summary_json TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  lease_owner TEXT,
  lease_until TEXT,
  last_error_code TEXT,
  response_id TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(transaction_id) REFERENCES kiosk_transaction(id)
);
CREATE INDEX IF NOT EXISTS ix_kiosk_host_outbox_due
ON kiosk_host_outbox(status, next_attempt_at, created_at);
CREATE TABLE IF NOT EXISTS kiosk_host_payload (
  payload_ref TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kiosk_host_response (
  response_id TEXT PRIMARY KEY,
  outbox_id TEXT NOT NULL,
  payload_ref TEXT NOT NULL,
  safe_summary_json TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(outbox_id) REFERENCES kiosk_host_outbox(id)
);
CREATE INDEX IF NOT EXISTS ix_kiosk_host_response_outbox
ON kiosk_host_response(outbox_id);`;

export const hostDeliveryMigration: Migration = {
  id: "kiosk-host-delivery.001.outbox-reconciliation",
  packageId: "@tripley-kit/web-container-kiosk-host-delivery",
  up: async (db) => db.executeBatch(HOST_DELIVERY_MIGRATION_SQL),
};
