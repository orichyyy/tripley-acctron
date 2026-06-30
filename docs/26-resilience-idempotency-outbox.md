# 26. Resilience, Idempotency, Operation Ledger, and Outbox

## Purpose

Provide shared safety patterns for host RPC, device operations, network calls, command execution, flow side effects, retry, circuit breaking, and reliable outgoing messages.

These modules are essential for banking/kiosk projects where duplicate host calls, duplicate dispense, duplicate payment, or lost messages are unacceptable.

## Resilience policy

Resilience is optional in generic framework packages but enabled by default in kiosk base for host/device/network calls.

```ts
export interface ResiliencePolicy {
  id: string;
  timeoutMs?: number;
  retry?: RetryPolicy;
  circuitBreaker?: CircuitBreakerPolicy;
  rateLimit?: RateLimitPolicy;
  fallback?: FallbackPolicy;
}

export interface ResilienceRegistry {
  register(policy: ResiliencePolicy): void;
  get(policyId: string): ResiliencePolicy;
  execute<T>(policyId: string, operation: () => Promise<T>, ctx?: ResilienceContext): Promise<T>;
}
```

## Retry rules

- Default retry is off.
- Retry must be explicit.
- Retry of side effects requires idempotencyKey or operation ledger entry.
- Payment, host debit, cash dispense, and card write must not be retried blindly.

Example:

```ts
await ctx.resilience.execute('host.rpc.authorization', async () => {
  return hostClient.sendAuthorization(request);
}, {
  traceId: ctx.traceId,
  idempotencyKey: request.idempotencyKey,
});
```

## Circuit breaker

```ts
export interface CircuitBreakerPolicy {
  failureThreshold: number;
  samplingWindowMs: number;
  openDurationMs: number;
  halfOpenMaxCalls?: number;
}
```

Use for host RPC or unstable peripheral services. Circuit open should surface as a typed `FrameworkError` and condition result, for example `HOST.CIRCUIT_OPEN`.

## Operation Ledger

Operation Ledger records side-effect operations and their idempotency keys.

```ts
export interface OperationLedger {
  start(operation: OperationDescriptor): Promise<OperationLease>;
  complete(operationId: string, result: unknown): Promise<void>;
  fail(operationId: string, error: unknown): Promise<void>;
  getByIdempotencyKey(key: string): Promise<OperationRecord | null>;
}

export interface OperationDescriptor {
  idempotencyKey: string;
  operationType: string;
  flowInstanceId?: string;
  transactionId?: string;
  traceId?: string;
  dataSummary?: unknown;
}
```

## Operation ledger table

```sql
CREATE TABLE IF NOT EXISTS framework_operation_ledger (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  operation_type TEXT NOT NULL,
  status TEXT NOT NULL,
  flow_instance_id TEXT,
  transaction_id TEXT,
  trace_id TEXT,
  data_summary_json TEXT,
  result_summary_json TEXT,
  error_json TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  failed_at TEXT
);
```

## Usage in side-effect nodes

```ts
const lease = await ctx.operationLedger.start({
  idempotencyKey: ctx.idempotency.create('cash.dispense', transactionId),
  operationType: 'cash.dispense',
  transactionId,
  flowInstanceId: ctx.instanceId,
  traceId: ctx.traceId,
});

try {
  const result = await ctx.devices.get<CashUnitPort>('cashUnit').dispense({ amount }, { operationId: lease.id });
  await ctx.operationLedger.complete(lease.id, result.safeSummary);
} catch (error) {
  await ctx.operationLedger.fail(lease.id, error);
  throw error;
}
```

## Outbox / Reliable Message

Outbox is optional in the framework but strongly recommended for banking projects. It stores outgoing messages before sending and retries pending messages according to policy.

```ts
export interface Outbox {
  enqueue(message: OutboxMessage): Promise<void>;
  markSent(id: string): Promise<void>;
  markFailed(id: string, error: unknown): Promise<void>;
  retryPending(policyId?: string): Promise<void>;
}
```

## Outbox table

```sql
CREATE TABLE IF NOT EXISTS framework_outbox (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  destination TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT,
  trace_id TEXT,
  transaction_id TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  last_error_json TEXT
);
```

## Best practices

- Host financial messages should be recorded in transaction message table and optionally outbox.
- Outbox does not replace transaction message repository; it is delivery control.
- Idempotency keys must be deterministic for operations that may be retried/resumed.
- Resilience policies must emit structured logs with `eventId`, operation type, duration, and result code.
