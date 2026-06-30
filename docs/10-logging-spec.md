# 10. Logging Spec

## Purpose

Define the framework logging contract using `@tripley-kit/logger` as the implementation base.

## Decisions

- Format: `JsonFormatter` + JSON Lines.
- Rolling: daily `/logs/app_{{yyyyMMdd}}.log`.
- Compression: project config, default enabled.
- Retention: 14 files.
- Transports: dev = console + native file; prod = native file.
- Native FS unavailable: console fallback + `logging.file.unavailable` warning.
- Level: dev DEBUG, kiosk prod INFO.
- Writes: dev direct, prod queued.
- Flush after error, close on shutdown.
- Event/Flow/Native call trace write to same app log file, with memory trace for devtools.
- Framework internal logs must have `metadata.eventId`.
- Redaction default: password, token, secret, pin, auth, privateKey.
- raw userId not allowed; hashed userId allowed.
- Viewer guidance included; viewer implementation not v1.

## LoggerPort

```ts
export interface LoggerPort {
  trace(message: string, metadata: FrameworkLogMetadata): void;
  debug(message: string, metadata: FrameworkLogMetadata): void;
  info(message: string, metadata: FrameworkLogMetadata): void;
  warn(message: string, metadata: FrameworkLogMetadata): void;
  error(message: string, error: unknown, metadata: FrameworkLogMetadata): void;
  child(metadata: Partial<FrameworkLogMetadata>): LoggerPort;
  flush?(): Promise<void>;
  close?(): Promise<void>;
}
```

## Record shape

Use the app log record shape defined by `@tripley-kit/logger`:

```ts
interface AppLogRecord {
  timestamp: string;
  level: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  message: string;
  metadata?: AppLogMetadata;
  error?: AppLogError;
}
```

All framework context goes in `metadata`.

## Framework metadata

```ts
export interface FrameworkLogMetadata {
  eventId: string;
  eventName?: string;
  eventCode?: number;
  module: string;
  action?: string;
  traceId?: string;
  sessionId?: string;
  requestId?: string;
  userId?: string; // hashed only
  source?: { file?: string; function?: string; line?: number };
  data?: FrameworkLogData;
  [key: string]: unknown;
}
```

## EventId namespace

```text
app.start
app.shutdown
config.loaded
config.changed
config.validation.failed
event.publish.started
event.publish.completed
event.publish.failed
event.deadLettered
flow.started
flow.node.started
flow.node.completed
flow.node.failed
flow.completed
flow.failed
flow.timedOut
window.open.requested
window.opened
window.focused
window.alwaysOnTop.changed
window.minimized
window.closed
window.crashed
plugin.registered
plugin.activated
plugin.activate.failed
native.call.started
native.call.completed
native.call.failed
native.capability.missing
kiosk.legacy.transaction.started
kiosk.legacy.transaction.completed
kiosk.legacy.transaction.failed
```

Project/plugin eventIds use namespaces:

```text
plugin.{pluginId}.*
device.{deviceType}.*
bank.host.*
project.{projectId}.*
```

## Error logging

Use:

```ts
logger.error('Failed to activate plugin', error, {
  eventId: 'plugin.activate.failed',
  eventName: 'Plugin activate failed',
  module: 'plugin-system',
  action: 'activate',
  traceId,
  data: { pluginId, version }
});
```

Do not put the main Error object into `metadata.data`.

## Privacy

Never log:

- secrets
- access tokens
- passwords
- private keys
- raw PIN
- raw PII
- full API responses
- unbounded arrays
- binary payloads

Prefer IDs, counts, durations, status codes, reason codes, and safe summaries.

## Viewer guidance

A viewer should filter by:

```text
timestamp
level
metadata.module
metadata.eventId
metadata.traceId
text over message/error.message/selected metadata
```

Group by `metadata.eventId`, not message.
