# Architecture

## Layering

- Interface adapters translate UI, host, container, and device calls into framework-neutral ports.
- Application services coordinate kiosk use cases and publish typed events.
- Domain modules hold service availability, transaction boundary, and timeout rules.
- Infrastructure adapters implement browser APIs, HTTP, logging, electronic journal, and future
  native IDL clients.

## Runtime Rules

The kiosk runtime is the single coordinator. Supervisor windows observe snapshots and submit
commands; they do not own business state. Host pause and administrator maintenance requests prevent
new transactions immediately. If a transaction is active, the state change becomes pending and is
applied after that transaction finishes.

Any unhandled transaction error enters recovery, calls `RecoveryPort.releaseAllHeldMedia()`, records
failures, and returns the runtime to idle. Customer choices pass through `InteractionRecorder`, which
writes both structured application logs and the electronic journal.

## Integration Direction

Container integration must use generated `@tripley-kit/native` clients from Tripley Native IDL.
React, routers, and state-management frameworks remain behind `PresentationPort`.

