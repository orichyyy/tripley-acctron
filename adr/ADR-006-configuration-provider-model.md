# ADR-006 Configuration Provider Model

## Decision

Configuration uses ordered providers with default CLI > env > SQLite > JSON > defaults, type-safe reads, validation, watch/reload, and writable SQLite provider for admin runtime changes.

## Consequences

- Admin can update host.ip/host.port and persist them.
- Types are preserved with value_json + value_type + schema_id.
