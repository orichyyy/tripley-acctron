# 11. Observability and Error Handling

## Purpose

Unify logs, Event Bus trace, Flow trace, Native call trace, health checks, diagnostics, and error catalog.

## Trace IDs

Every user-visible transaction should have:

```text
traceId
correlationId
causationId
sessionId
transactionId
flowInstanceId
windowKey
pluginId when applicable
```

These fields propagate through Event Bus envelopes, Flow context, Logger metadata, Native calls, transaction messages, and audit journal.

## Trace types

```text
Event trace
Flow trace
Command trace
Native call trace
Window lifecycle trace
Device operation trace
Plugin lifecycle trace
Configuration change trace
```

All can write to the same app log file. Event/Flow retain optional memory traces for devtools.

## Error catalog

```ts
export interface FrameworkErrorDescriptor {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error' | 'fatal';
  recoverable: boolean;
  userMessageKey?: string;
  module?: string;
}
```

Examples:

```text
NATIVE.CAPABILITY_MISSING
NATIVE.WINDOW.UNSUPPORTED_FEATURE
FLOW.USER_INPUT_TIMEOUT
FLOW.INTERRUPTED
DEVICE.PINPAD.UNAVAILABLE
DEVICE.CARD.REMOVED
KIOSK.CASH.EMPTY
HOST.TIMEOUT
CONFIG.VALIDATION_FAILED
PLUGIN.ACTIVATE_FAILED
```

Do not branch on `Error.message`; branch on `code` or reasonCode.

## Health checks

```ts
export interface HealthCheck {
  id: string;
  run(ctx: HealthCheckContext): Promise<HealthCheckResult>;
}
```

Built-in health checks:

- native capability.
- window/display API.
- SQLite open and migration status.
- log file writer.
- plugin activation.
- device status.
- host RPC connection.
- configuration schema.
- display role mapping.

Admin UI should show health results. Startup fail-fast should include health diagnostics when possible.

## Diagnostics bundle

Future enhancement: package recent logs, config summaries, health checks, flow traces, device statuses, and transaction IDs for support export. Do not include secrets/raw PII.
