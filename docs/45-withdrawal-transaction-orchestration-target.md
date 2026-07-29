# Target 45: Withdrawal Transaction Orchestration and Finalization

## Status

Implemented.

## Objective

Compose host authorization, CDM cash delivery, IDC card custody, project gates, durable local
finalization, and application protection recovery into one auditable withdrawal boundary. Device
services remain independent and bank projects own transaction ordering and host protocol choices.

## Scope

- A registry-driven withdrawal policy with card-first and cash-first ordering.
- Contact-card and cardless-reservation entry modes.
- Project pre-present gates such as mobile OTP without hard-coding a verification mechanism.
- Host authorization before cash movement.
- Configurable authorization/cash-planning order. Projects whose host request
  requires denomination counts may plan and persist the before snapshot first,
  pass the typed one-use plan to authorization, and still prohibit cash
  movement until approval.
- Structured trigger, cash execution, cash custody, and card custody facts.
- Application recovery-barrier admission before a transaction starts.
- Mandatory local transaction, EJ/audit, and scoped-state finalizers.
- Optional Host Financial Completion as a separately registered finalizer.
- Kiosk-base transaction and audit adapters.

## Ordering policies

`return-before-cash-present` requires authoritative `returned/taken` card custody before issuing a
cash presentation authorization. Timeout, retention, unknown custody, or intervention blocks
`present` and resolves staged cash through the CDM session.

`return-after-cash-terminal` presents cash first, records whether it was taken, retracted, or became
unknown, and then resolves card custody. A card failure never rewrites the already observed cash
outcome.

`managed-by-parent-session` leaves card custody with an authenticated parent
Card Session. The withdrawal subflow records `session-retained` and never
ejects or retains the card. A successful child may return to the parent menu;
failed children let the parent perform the one final card disposition.

Cardless reservation withdrawals omit IDC custody and may register an OTP gate after dispense but
before present. Gate cancellation, timeout, or rejection prevents present and retracts staged cash.

The default planning order remains authorization before cash planning.
`cash-planning-before-authorization` acquires the cash session, records the
before snapshot, and creates a denomination plan before calling the host. A
decline or unavailable host aborts that non-moving session; `dispense` is never
called. The Host authorization port receives the typed plan without exposing
device internals to Flow code.

## Finalization

Every admitted operation runs the frozen Operation Finalization Plan. Local transaction projection,
terminal EJ/audit, and scoped-state reset are always registered. Authorization-only projects do not
register a Host Financial Completion finalizer. Authorization-then-completion projects register it
after all local finalizers, so failure or retry of the host message cannot skip local cleanup.

## Safety and investigation

- Trigger cause is separate from physical custody facts.
- Cash facts state dispense and present certainty, terminal custody, before/after snapshot IDs, and
  recovery transfer.
- Card facts preserve returned, retained, presented, cancelled, or intervention status and reason.
- No PAN, track, PIN, OTP, raw host payload, or vendor error text enters the outcome or finalizers.
- A recovery or intervention barrier blocks admission before host authorization or device movement.

## Acceptance evidence

- Cardless OTP cancellation after dispense never presents cash and records retraction.
- Card return failure in card-first ordering blocks present.
- Cash-first ordering records cash take before resolving card custody.
- Cash take timeout records present and retract facts independently.
- Authorization-only projects complete every local finalizer without a completion message.
- Completion-enabled projects invoke the optional finalizer after local cleanup.
- Project gate and policy contributions require no core modification.
- A denomination-sensitive host receives the planned cash mix before
  authorization, while a decline releases the plan without dispensing.
- A parent Card Session can retain card authority across a successful
  withdrawal without the child ejecting the card.

## Follow-up

Target 46 applies the same orchestration and finalization vocabulary to CIM deposit transactions,
including escrow review, physical commit/rollback, returned-media custody, and optional host posting.
