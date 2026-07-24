# Target 57: Taiwan BSP v2.43 Withdrawal Host Runtime

## Objective

Compose the Target 55 BSP session profile and Target 56 withdrawal bindings into
one application-owned runtime that is ready for kiosk transaction orchestration.

## Scope

- Register the BSP IWD authorization and optional IWF completion bindings.
- Register one persistent native TCP host session using the BSP BCD length frame.
- Establish each transport generation with OEX before reporting host readiness.
- Route IWD and IWF replies only to matching pending durable exchanges.
- Adapt message bindings to the durable host-delivery boundary.
- Expose the withdrawal host posting port, session supervisor, readiness
  condition, and health check.
- Keep SQLite, payload encryption, inquiry, and bank context implementations
  outside the composition through explicit factories and ports.

## Lifecycle

1. Construct profile, bindings, transport registry, and durable exchange.
2. Start the session supervisor.
3. Connect the persistent native TCP transport.
4. Send OEX for the current transport generation.
5. Mark the host ready only after an accepted OEX reply.
6. Admit withdrawal authorization through the ready condition.
7. Dispose the supervisor, which disposes the persistent transport.

## Safety Decisions

- Durable delivery is created before any financial exchange and remains the
  authority for retry, uncertain outcome, and reconciliation.
- A reconnect creates a new transport generation and requires OEX again.
- The response router checks both transaction code and pending binding identity.
- Host Financial Completion remains optional at project configuration level.
- The runtime does not hold or log sensitive context; the Target 56 provider
  resolves it only while projecting a request.

## Acceptance

- A simulated native TCP session establishes with OEX and becomes ready.
- An IWD authorization traverses context provider, durable bridge, message
  transport, persistent session, frame router, and reply mapper.
- IWD and IWF replies cannot satisfy the wrong pending binding.
- Runtime health and readiness reflect the session supervisor.
- Disposal closes the persistent transport.

