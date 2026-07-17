# ADR 0032: Separate interruption trigger, execution evidence, and custody outcome

Withdrawal and deposit investigations must not collapse all outcomes into one failure reason. The runtime records an append-only evidence stream containing intent, completion, device event, interruption, and reconciliation observations. An interruption trigger such as cancel or timeout is recorded separately from evidence of what the device executed and from the final custody outcome of card, cash, or deposited media.

Missing events and command timeouts are not treated as proof that a physical action did not happen. Evidence carries its source and certainty, and unresolved physical state ends as `unknown` and requires reconciliation or operator intervention. Device integrations emit safe structured evidence; the application runtime persists and correlates it without storing PIN, OTP, card-track data, or unrestricted native payloads.
