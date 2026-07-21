# Target 44: XFS IDC Card Custody Service

## Status

Implemented.

## Objective

Provide an application-facing IDC custody boundary that turns low-level XFS media status and
commands into authoritative, auditable outcomes. Withdrawal orchestration must be able to require
a returned card before cash presentation without interpreting XFS constants or vendor errors.

## Scope

- `CardCustodyService` for return, retain, and reconnect reconciliation.
- `CardCustodyPolicyRegistry` for project-owned take-timeout and interrupt actions.
- Host-backed command leasing with host epoch, fencing token, owner, and resource-group binding.
- Host protection phases for card-inside, eject-in-flight, customer-accessible, and retain-in-flight.
- Configurable host actions for direct retain or return-then-timeout-retain after disconnect.
- Structured terminal reasons for cancel, timeout, node exit, device loss, eject failure, retain
  failure, stale authority, jam, and unknown custody.
- Append-only safe evidence suitable for EJ, audit, and transaction investigation projections.
- Abort propagation for eject and retain commands.
- Real hostd/XFS simulator coverage for fenced eject and customer take.

## Public contract

`returnCard()` ejects the card and waits for customer removal. The selected policy decides whether
a take timeout or interruption retains the card, leaves it presented, or requires intervention.
Transactions pass the fenced authority acquired before card read into `returnCard()` so one lease
covers the complete read-to-terminal custody lifecycle; the service releases it at the terminal.

`retainCard()` explicitly transfers the card to the retain bin under recovery authority.

`reconcile()` observes media under observation authority. Absence after reconnect is deliberately
reported as `custody-unknown`: media status alone cannot prove whether the customer took the card
or the device retained it.

Only a `returned` result satisfies `cardCustodyAllowsCashPresentation()`. Projects that present cash
first can invoke card custody after cash transfer; the service does not hard-code cross-device order.

## Safety rules

- No track, PAN, chip, or raw card data may enter evidence or safe summaries.
- Only an explicit IDC `mediaRemoved` service event proves customer take; `fwMedia=NOT_PRESENT`
  alone is not custody evidence because an ejected card may already be outside the transport sensor.
- Vendor error messages are not copied into results; only stable error codes or error class names
  are retained.
- Authority rejection occurs before a physical device command.
- Failure to prove custody blocks return-before-present transaction policies.
- Evidence is sequenced per operation and includes host epoch and fencing token after acquisition.

## Extension model

Each bank registers named, versioned policies. EJ and database integrations implement
`CardCustodyEvidenceSink`; multiple sinks can be composed with `CompositeCardCustodyEvidenceSink`.
The core service depends only on `XfsCardReaderPort`, `CardCustodyLeasePort`, and the evidence port.
IDC logical services require an explicit host protection resource-group mapping; host epoch, owner,
profile, resource group, and fencing validation remain mandatory.

## Acceptance evidence

- Normal eject and take returns `returned/taken` and releases authority.
- Take timeout applies the registered retain policy.
- Node exit and other interrupts apply project policy without allowing cash presentation.
- Eject failure returns a stable reason and safe failure code.
- Stale authority prevents device movement.
- Reconnect observation does not invent a taken or retained outcome.
- A custom leave-presented policy requires no core modification.
- Hostd simulator proves real IDC eject/take with a fencing lease.

## Follow-up

Target 45 composes IDC custody with CDM/CIM, host authorization, optional Host Financial
Completion, transaction cleanup, and the application protection recovery barrier.
