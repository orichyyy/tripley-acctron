# @tripley-acctron/observability

Logger, in-memory log sink, redaction, Electronic Journal, and interaction audit implementations.

Update this document when log fields, redaction rules, or journal contracts change.

## Logger

`InMemoryLogger` records `LogEntry` values with level, message, timestamp, and optional attributes.

## Electronic Journal

`InMemoryElectronicJournal` records structured `JournalEntry` values and fills missing timestamps.

## Redaction

`DefaultRedactionService` fully redacts PIN and password values. Account, card, ID, barcode, and
generic customer input values are masked before they reach log or EJ records.

## Interaction Audit

`DefaultInteractionAuditService` writes prompt lifecycle, customer choice, and customer input records
to both `Logger` and `ElectronicJournal`, using `RedactionService` before emitting data.
