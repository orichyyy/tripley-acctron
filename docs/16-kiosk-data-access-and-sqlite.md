# 16. Kiosk Data Access and SQLite

## Purpose

Define standard storage for kiosk transaction records, transaction messages, counters, audit journal, configuration KV, migrations, and optional Drizzle adapter.

## SQLite in kiosk base

SQLite storage is required for kiosk base; optional for generic framework users.

## Standard transaction table

```sql
CREATE TABLE IF NOT EXISTS kiosk_transaction (
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
);
```

## Transaction message table

```sql
CREATE TABLE IF NOT EXISTS kiosk_transaction_message (
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
ON kiosk_transaction_message(transaction_id, seq);
```

Messages are separate records, not a single JSON array inside transaction, so diagnostics and timeline queries stay efficient.

## Transaction repository

```ts
export interface TransactionRepository {
  create(input: CreateTransactionInput): Promise<TransactionRecord>;
  appendMessage(transactionId: string, message: AppendTransactionMessageInput): Promise<TransactionMessageRecord>;
  updateStatus(transactionId: string, status: TransactionStatus, patch?: TransactionStatusPatch): Promise<void>;
  get(transactionId: string): Promise<TransactionRecord | null>;
  listMessages(transactionId: string): Promise<TransactionMessageRecord[]>;
}
```

## CounterService

Counter is framework storage core, not only kiosk.

```sql
CREATE TABLE IF NOT EXISTS framework_counter (
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  value INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT,
  PRIMARY KEY(scope, name)
);
```

```ts
export interface CounterService {
  get(scope: string, name: string): Promise<number | null>;
  getOrCreate(scope: string, name: string, initialValue?: number): Promise<number>;
  increment(scope: string, name: string): Promise<number>;
  incrementBy(scope: string, name: string, delta: number): Promise<number>;
  reset(scope: string, name: string, value?: number): Promise<number>;
}
```

`increment` must be atomic. Do not implement business counters as separate `get + set` calls.

## Audit journal / EJ table

```sql
CREATE TABLE IF NOT EXISTS kiosk_audit_journal (
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
);
```

## Drizzle strategy

Framework core does not depend on Drizzle. Provide optional `storage-drizzle-adapter`.

Production-ready Drizzle adapter should wait for native SQLite raw query result and batch APIs. Until then, use repositories and query helpers for production kiosk flows.

## Custom project tables

Project plugins register migrations and repositories:

```ts
ctx.migrations.register({ id: 'bank.customer-profile.001', up: async db => { ... } });
ctx.repositories.register('bank.customerProfile', new CustomerProfileRepository(db));
```
