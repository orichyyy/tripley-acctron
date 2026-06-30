# ADR-007 Logging Format

## Decision

Use `@tripley-kit/logger` JSON Lines app logs through LoggerPort. Framework internal logs require metadata.eventId.

## Consequences

- Logs are viewer-friendly and readable in raw files.
- eventId/module/action/traceId become primary analysis keys.
- Secrets and raw PII are redacted or omitted.
