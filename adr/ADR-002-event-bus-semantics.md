# ADR-002 Event Bus Semantics

## Decision

Event Bus supports async dispatch, error isolation, timeout, request/response, dead-letter, trace, same publisher+topic ordering, but no automatic retry in v1.

## Consequences

- Retry policies live in Flow Engine/resilience layer.
- Side effects are not silently repeated.
- Publish returns handler results.
