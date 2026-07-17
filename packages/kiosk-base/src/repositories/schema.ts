export const kioskTransactionTableSql = `CREATE TABLE IF NOT EXISTS kiosk_transaction (
  id TEXT PRIMARY KEY,
  business_type TEXT NOT NULL,
  status TEXT NOT NULL,
  amount INTEGER,
  currency TEXT,
  session_id TEXT,
  flow_instance_id TEXT,
  trace_id TEXT,
  correlation_id TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  failed_at TEXT,
  result_code TEXT,
  result_message TEXT,
  metadata_json TEXT
);`;

export const kioskTransactionMessageTableSql = `CREATE TABLE IF NOT EXISTS kiosk_transaction_message (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  direction TEXT NOT NULL,
  message_type TEXT NOT NULL,
  channel TEXT,
  status TEXT,
  request_id TEXT,
  trace_id TEXT,
  correlation_id TEXT,
  payload_json TEXT,
  payload_hash TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(transaction_id) REFERENCES kiosk_transaction(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transaction_message_seq
ON kiosk_transaction_message(transaction_id, seq);`;

export const kioskAuditJournalTableSql = `CREATE TABLE IF NOT EXISTS kiosk_audit_journal (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  event_name TEXT,
  business_type TEXT,
  transaction_id TEXT,
  session_id TEXT,
  flow_instance_id TEXT,
  trace_id TEXT,
  message TEXT NOT NULL,
  data_json TEXT,
  created_at TEXT NOT NULL
);`;
