# ADR 0038: Cash-unit correlation separates slot, cassette, and revision

A cash-unit observation identifies the logical service and stable logical slot separately from any device-provided physical cassette identifier, position, cash-unit type, configuration revision, and replenishment cycle. Missing physical identity is recorded with reduced certainty rather than replaced with an invented stable identifier.

Replenishment, cash counting, cassette replacement, denomination changes, and equivalent maintenance establish a new cash-unit revision. Framework maintenance operations share the cash-device lock with transactions. An unexpected revision or incompatible counter change caused by an external maintenance path marks the transaction `reconciliationRequired`.

Before and after observations with different revisions are not directly subtracted as a transaction delta. Deltas are reproducible projections over compatible canonical observations, not original facts. A `CashDispensePlan` is bound to the observed cash-unit revision and becomes invalid when that revision changes.
