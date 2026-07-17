# ADR 0033: Cash-changing transactions capture boundary inventory snapshots

Every transaction that can change CDM or CIM cash-unit state captures an immutable `before` inventory snapshot before its first cash-affecting action and attempts an `after` snapshot from transaction finalization on every success, rejection, cancellation, timeout, recovery, and failure path. Snapshot capture attempts and failures are themselves evidence; an unavailable or partial snapshot is never silently replaced by inferred values.

The `before` snapshot is a fail-closed cash movement evidence gate: it must be complete and durably persisted before the runtime may issue the first cash-affecting command. If capture or persistence fails, the transaction stops before physical cash movement. Once cash movement may have started, evidence failures must not prevent custody-safety actions such as retract, rollback, status reconciliation, or operator escalation.

An `after` snapshot failure does not rewrite a confirmed or possible physical outcome. The operation is marked `reconciliationRequired`; a later recovery observation is recorded separately as reconciliation evidence and never presented as the original transaction-boundary snapshot.

Canonical snapshots contain structured cash-unit identifiers, typed counters, status, capture boundary, timestamps, transaction correlation, device identity, and source certainty. They are persisted with the transaction record and rendered to EJ from the same canonical evidence. Device services expose observations but do not format EJ or bank reports.

Bank projects extend registered investigation projectors and formatters to produce project-specific EJ text, database reporting views, and external management-system messages. These projections may add project metadata and choose field order or representation, but they cannot mutate canonical snapshots or expose restricted device details outside the configured security policy.
