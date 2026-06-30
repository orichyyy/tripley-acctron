# ADR-003 Flow Engine Model

## Decision

Flow is a DAG with typed/extensible node kinds. Flow starts explicitly. UserInput nodes are first-class. Timeout/interrupt/retry/recovery are policies. Direct ctx and effect-first are both supported.

## Consequences

- Kiosk flows can express user input, devices, host calls, parallel checks, race conditions, and subflows.
- Testing runner can assert paths and trace snapshots.
