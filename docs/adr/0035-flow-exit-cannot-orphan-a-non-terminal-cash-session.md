# ADR 0035: Flow exit cannot orphan a non-terminal cash session

A flow timeout, interrupt, route exit, or user cancellation records an abort request but does not directly dispose of or generically cancel a `CashDeliverySession`. The session stops actions that have not started, inspects available device state, performs required retract or reconciliation, and produces one of the custody terminal outcomes: `taken`, `retracted`, `notDispensed`, or `custodyUnknown`.

States including dispensing, cash staged, presenting, presented awaiting take, retracting, and reconciling are non-terminal. A flow node may exit only after its session reaches a terminal outcome or after ownership is atomically transferred to a durable recovery supervisor. The transfer preserves operation identity, session generation, evidence ordering, abort trigger, device lock responsibility, and remaining recovery deadline.

A staged-cash abort must not present cash. A dispense timeout does not prove that cash was not dispensed. A take timeout is recorded independently from any subsequent retract result. Device events are preferred evidence; bounded status queries may support reconciliation but must identify inferred certainty. If custody cannot be established, the result is `custodyUnknown` and requires operator investigation.
