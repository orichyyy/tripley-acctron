# ADR 0036: Cash presentation requires policy authorization

The project flow explicitly controls whether card handling, a mobile challenge, or another business step occurs before or after cash presentation. These steps are not encoded in the CDM module. A project-owned `CashPresentationPolicy` is frozen at operation start and references open, registered presentation gates.

Before `present()`, the runtime evaluates the frozen policy and issues a short-lived, one-use `CashPresentationAuthorization` bound to the operation, cash delivery session, policy, and satisfied gates. The CDM session rejects a missing, expired, reused, or mismatched authorization. Gate failure, cancellation, or timeout requests abort and drives staged cash toward retract rather than presentation.

A policy that delays presentation is valid only when the selected logical service proves support for separate staging, present, staged-cash retract, and required status reconciliation. Capability failure is detected before the transaction starts and cannot silently degrade to immediate presentation. OTP, card, NFC, and future project gates are contributed through registries and never become dependencies of the CDM adapter.
