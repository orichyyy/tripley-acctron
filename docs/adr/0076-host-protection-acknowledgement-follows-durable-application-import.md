# ADR 0076: Host protection acknowledgement follows durable application import

## Status

Accepted.

## Context

Tripley Native Host can finish phase-aware CDM/CIM protection while the Kiosk Runtime is disconnected. On restart, the application must preserve the host facts in transaction evidence and project-specific audit/EJ records before allowing host acknowledgement to make the protected resource group idle. A crash can occur between any import, projection, reconciliation, acknowledgement, or local checkpoint write.

## Decision

The application uses a Protection Recovery Import before acknowledging terminal host protection.

The import order is fixed:

1. Read host epoch, protection status, and safe journal records.
2. Atomically persist a local recovery case and idempotently keyed journal records.
3. Run every registered project projection with a stable idempotency key.
4. Reconcile application recovery leases through an idempotent application port.
5. Persist an acknowledgement intent.
6. Acknowledge host protection.
7. Persist local acknowledgement completion.

An acknowledgement intent plus idle status from the same host epoch is sufficient evidence to close the crash window after a successful host acknowledgement whose response was lost. A changed host epoch, missing journal, unknown custody outcome, or unexplained idle state enters intervention and never manufactures terminal custody.

## Consequences

- Host protection cannot be acknowledged before required application evidence and project projections are durable.
- Project audit, EJ, transaction, and management-system integrations remain open adapters and must honor supplied idempotency keys.
- Repeated startup import is safe, including crashes immediately before or after acknowledgement.
- The Recovery Startup Barrier remains closed while any configured resource group is recovering, in intervention, or unavailable.
- Host protection facts remain separate from Flow state and never resume customer business execution.
