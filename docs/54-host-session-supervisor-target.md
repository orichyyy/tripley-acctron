# Target 54: Host Session Supervisor

## Objective

Add a transport-neutral supervisor above Target 53 persistent duplex sessions. It establishes a
project-owned host protocol, gates transaction readiness, sends heartbeat control messages, and
recovers safely across connection generations without putting BSP fields in framework core.

## Boundaries

- Target 53 owns sockets, framing, reconnect, inbound dispatch, and delivery certainty.
- Target 54 owns protocol readiness, control-message timing, generation fencing, health, and
  condition integration.
- Project hooks own sign-on, echo, sign-off payloads and response interpretation.
- Financial messages continue through Target 50/51 durable delivery. Session control messages do
  not enter the financial outbox.
- The Taiwan BSP ATM v2.43 profile remains project code and can implement the protocol hooks without
  modifying this package.

## State and recovery

- A connected transport is not transaction-ready until establishment is accepted.
- Disconnect immediately removes availability and cancels active protocol work.
- Results are accepted only for the current transport generation and operation epoch.
- Establishment retries use bounded exponential backoff.
- Heartbeat failures are counted; reaching the configured threshold degrades the session and starts
  protocol re-establishment.
- Required sessions can fail application startup. Optional sessions allow degraded startup.

## Security

- Supervisor events expose only IDs, state, generation, operation, timing, and stable reason codes.
- Raw payloads, decoded fields, exception text, PAN, PIN blocks, and credentials are forbidden.
- Hook exceptions are replaced with a stable safe error code.

## Acceptance

- Project establishment gates readiness.
- Heartbeat threshold and bounded re-establishment work deterministically.
- Late results from retired generations cannot restore availability or send on a new generation.
- Timeout, disconnect, and disposal cancel active protocol operations.
- Condition and health adapters reflect current readiness.
- A custom BSP protocol hook works without core changes.
- Package and workspace tests, typecheck, and build pass.
