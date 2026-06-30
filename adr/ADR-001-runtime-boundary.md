# ADR-001 Runtime Boundary

## Decision

The framework treats the native host as a capability provider and isolates it behind `NativePort`. Business code and plugins do not depend on raw `TripleyNative`.

## Consequences

- SDK changes affect only native-adapter.
- Tests can use mock native ports.
- Missing capabilities fail fast.
- SDK gaps are recorded in `docs/14-native-sdk-api-requirements.md`.
