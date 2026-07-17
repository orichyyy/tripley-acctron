# ADR 0039: Cash reconciliation preserves independent financial and physical facts

Cash-changing transactions preserve business intent, device planning, device execution reports, compatible inventory observations, customer custody, and host posting as independent facts. Values use currency plus integer minor units and retain their source and certainty. A customer taking cash does not prove host posting success, and host posting success does not prove physical delivery or acceptance.

Withdrawal reconciliation separately records the requested amount, denomination plan, device-reported dispense result, inventory-observed delta, custody outcome, and host posting outcome. Deposit reconciliation separately records any customer-declared amount, device-recognized amount, committed amount, compatible inventory delta, returned or retracted media, and host posting outcome.

A versioned `CashMovementReconciliation` derives comparisons without modifying evidence. Differences become immutable `CashDiscrepancy` records. Registered project resolvers may apply bank-specific tolerances, classifications, routing, and reporting, but cannot rewrite source facts. Unresolved material discrepancies mark the operation `reconciliationRequired`.
