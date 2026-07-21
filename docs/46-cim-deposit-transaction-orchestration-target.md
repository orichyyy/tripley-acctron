# Target 46: CIM Deposit Transaction Orchestration and Finalization

## Status

Implemented.

## Objective

Compose CIM cash acceptance, customer escrow review, exact-revision host authorization, physical
commit or rollback, returned-media custody, inventory evidence, and durable finalization into one
application-facing deposit boundary.

## Scope

- Registry-driven multi-batch escrow review and bank policy gates.
- Configurable CIM logical service, resource group, positions, timeouts, and not-taken action.
- Exact escrow revision and hash binding for Host Authorization and CIM Physical Commit.
- Refused-media custody resolution through a project adapter.
- Structured accepted, refused, returned, retracted, committed, and unknown portion facts.
- Before and after cash inventory snapshot references.
- Application protection recovery barrier before transaction admission.
- Mandatory transaction, EJ/audit, and scoped-state finalizers.
- Optional Host Financial Completion as a separate project contribution.

## Transaction model

The orchestrator starts CIM acceptance only after a successful before-inventory observation. Each
accepted batch creates an immutable escrow revision. A project review gate may request another
batch, confirm the current escrow, cancel, time out, or reject it. Refused media must be observed as
taken or retracted before physical commit; missing or unknown custody fails closed.

After confirmation, the host authorizes the exact current revision and snapshot hash. Only that
authorization can call `cashInEnd`. A declined or unavailable authorization rolls back all escrow.
A possibly dispatched physical commit is never retried and becomes recovery-required evidence.

## Host posting

CIM Physical Commit and Host Financial Completion are distinct. Authorization-only projects omit
the completion finalizer. Authorization-then-completion projects register it after all local
finalizers. Local cleanup and investigation facts never depend on host completion availability.

## Safety and investigation

- Returned or refused media is terminal only after observed take or known retract custody.
- Trigger cause remains separate from command execution and custody facts.
- Before/after inventory capture failure never rewrites a confirmed physical outcome.
- PAN, PIN, OTP, raw host messages, note images, and vendor error text are excluded.
- Unknown commit, returned-media, or inventory state enters intervention and keeps recovery visible.

## Acceptance evidence

- Normal multi-batch deposit authorizes the latest revision and commits once.
- Customer cancel rolls back and records returned-and-taken media.
- Return timeout may retract to a known area.
- Host decline never calls physical commit.
- Commit execution uncertainty is not retried and enters recovery-required intervention.
- Unresolved refused or returned media fails closed.
- Authorization-only projects execute every local finalizer without a completion message.
- Completion-enabled projects invoke the optional message after local cleanup.
- Recovery intervention blocks host and CIM activity before admission.

## Follow-up

Target 47 should add a hostd-backed end-to-end withdrawal and deposit transaction contract using
the orchestration packages with the real XFS simulator, durable application stores, and restart
recovery checkpoints.
