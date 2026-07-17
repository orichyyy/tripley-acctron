# ADR 0042: Physical-media commands are not automatically retried

Commands that can move cash, deposited media, or a card use at-most-once dispatch by default. This includes dispense, present, retract, CIM commit, CIM return or rollback, and card retain. A transport timeout or disconnect after a command may have crossed the native boundary does not prove non-execution and therefore cannot trigger an automatic retry.

The operation ledger prevents duplicate application submission, and durable intent precedes dispatch. If dispatch outcome is uncertain, the session records `executionUnknown`, blocks duplicate dispatch, and reconciles using events, status, compatible inventory observations, recovery lease evidence, and operator intervention when required. XRPC request identity is not treated as semantic device idempotency.

Bounded retry is permitted for explicitly classified read-only observations. A side-effecting adapter may support replay only when its declared capability provides durable semantic idempotency for the same operation and idempotency key; ordinary request deduplication or a new connection is insufficient proof.
