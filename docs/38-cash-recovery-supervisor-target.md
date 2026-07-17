# Cash Recovery Supervisor and Durable Lease Target

## Status

Ready for implementation.

## Objective

Implement a persistent Cash Recovery Supervisor that owns every non-terminal CDM session when foreground Flow cannot safely retain ownership. Connect application recovery leases to host-backed logical-service command leases so restart, reconnect, timeout, interrupt, and execution-unknown paths preserve single-owner command authority and physical custody evidence.

This target completes the shared crash-recovery foundation before introducing CIM cash acceptance.

## Responsibility boundary

- The external Kiosk Launcher replaces a failed Kiosk Runtime within the project-defined Runtime Restart Window.
- A production preset with cash devices requires a launcher supervision contract, runtime instance identity, prior-exit observation, and an explicitly configured restart window; there is no production default.
- The example and simulator harness use a 30-second test window without presenting it as a production recommendation.
- The replacement runtime enters a Recovery Startup Barrier before exposing cash service availability or accepting customer operations.
- The Tripley Native Host validates host epoch, fencing token, lease owner, authority mode, and command whitelist immediately before XFS dispatch.
- Hostd does not select bank recovery policy, interpret operation evidence, or autonomously resume a customer transaction.
- Device or firmware automatic protective behavior is observed as evidence and reconciled; it is never assumed from elapsed time alone.
- A deployment that cannot guarantee the restart window requires an explicit recovery agent with the same lease and evidence contracts.
- A replacement runtime that starts after the configured window still performs recovery but records the supervision breach and cannot classify it as normal startup.

## Required foundation

- Persist `CashRecoveryLease` identity, operation, session, module, logical service, physical phase, evidence sequence, owner instance, deadline, authority, host epoch, and monotonically increasing fencing token.
- Define a launcher supervision port that reports runtime instance identity, startup observation, prior exit reason when known, and watchdog health without exposing process-control details to business modules.
- Acquire, renew, transfer, take over, and close leases through compare-and-swap semantics.
- Bind each active application lease to the matching host-backed command lease.
- Reject stale runtime, stale connection, stale host epoch, wrong authority, and stale fencing token before native command dispatch.
- Persist phase transitions and safe evidence before releasing ownership or issuing the next physical-media command.
- Treat transport loss after possible dispatch as `Execution Unknown`; never automatically repeat dispense, present, or retract.

### Recovery authority transition

- A healthy foreground owner persists a `transferPending` recovery-lease state with the next fencing token before requesting native authority transition.
- Hostd provides an owner-authorized transition that preserves operation, session, and logical service while atomically changing `transaction` authority to `recovery` and advancing the fencing token.
- The transition never releases the logical-service command lease; the previous token becomes stale immediately when host transition succeeds.
- The application persists `recoveryBound` only after observing the accepted host epoch, authority, and fencing token.
- Startup recovery resolves `transferPending` by comparing durable state with host lease status and then completing the binding or waiting for fenced takeover; it does not guess which side committed.
- A different runtime cannot use authority transition. It takes over only after the previous host lease expires and only with a higher fencing token.
- This requires coordinated contract changes across tripley-native-hostd, xRPC/native client boundaries, `@tripley-kit/xfs-client`, and the framework lease coordinator.

## Recovery behavior

- Foreground Flow may exit a non-terminal cash session only after atomic ownership transfer to the Recovery Supervisor.
- Runtime startup and host reconnect discover unresolved leases before declaring the logical service available.
- Recovery reconstructs state from durable evidence, current device status, present status, compatible inventory observations, and new host events rather than old in-memory objects or native request handles.
- Recovery may retract or reconcile under recovery authority but cannot initiate a new dispense or resume customer business Flow.
- A confirmed terminal custody outcome closes the recovery lease and releases host authority.
- `custodyUnknown` enters Terminal Intervention and keeps the logical service unavailable until authorized reconciliation evidence resolves it.

### Recovery transfer boundary

- Foreground ownership may close directly only when durable device evidence proves the terminal outcome `notDispensed`.
- Cash that is staged, presented, awaiting take, retracting, `executionUnknown`, or otherwise not provably unmoved crosses the Recovery Transfer Boundary when foreground business activity stops.
- Cancel, interaction timeout, operation deadline, presentation-gate failure, route exit, and runtime shutdown remain distinct interruption triggers; none manufactures a custody outcome.
- Flow persists the abort request and `transferPending`, then waits only until the Recovery Supervisor accepts durable ownership before exiting.
- Physical retract and reconciliation continue independently under the Supervisor rather than extending foreground Flow lifetime.
- If a native command remains active, the Supervisor may accept durable application ownership while host binding remains `transitionPending`; no recovery command is dispatched until authority transition succeeds or fenced takeover becomes valid.
- Failure to persist ownership transfer blocks Flow exit, device-lock release, runtime shutdown completion, and admission of a new customer operation.

### Recovery deadline

- The Recovery Deadline is an escalation and audit threshold, not a host lease expiry or command cutoff.
- Passing the deadline appends a supervision-breach evidence record and enters Terminal Intervention without releasing application or host fencing.
- Recovery authority remains limited to observation and evidence-backed custody-reducing actions; it never permits dispense, present, or customer Flow resumption.
- Status, present-status, compatible inventory observation, and retract remain permitted only when current evidence supports their safety.
- If safe action cannot be established, recovery records `custodyUnknown` and waits for authorized operator reconciliation.
- A later `taken` or `retracted` observation records the true custody outcome but does not erase or downgrade the earlier deadline breach.

### Terminal intervention resolution

- The Recovery Supervisor retains fencing until an authenticated local Maintenance Intervention Session accepts ownership through a no-release-window authority transition from `recovery` to `maintenance`.
- A registered `InterventionResolutionPolicy` defines required operator roles, reason codes, optional dual approval, mandatory observations, and return-to-service conditions.
- Minimum evidence includes current device status, present status, cash inventory observation, operator identity, reason code, physical action, and time. An unavailable observation is recorded explicitly rather than replaced with an inferred value.
- Intervention Resolution is append-only and cannot rewrite the original `custodyUnknown`, Recovery Deadline breach, dispatch intent, or execution evidence.
- External management systems may contribute approval and receive investigation artifacts but cannot directly clear fencing or bypass the local maintenance session.
- The logical service becomes available only after project policy accepts the reconciliation outcome and all maintenance ownership is safely closed.

## Required tests

- Flow exit while cash is staged transfers ownership and recovery retracts without presenting.
- Flow closes without recovery transfer only when durable evidence proves `notDispensed`.
- Cancellation, timeout, route exit, and shutdown preserve their trigger while producing custody from independent device evidence.
- Process loss after dispense but before present is recovered by a replacement runtime after restart.
- Process loss after present distinguishes taken, retracted, and custody unknown from current evidence.
- A stale runtime and stale fencing token cannot issue accepted device commands after takeover.
- A healthy transaction-to-recovery transition has no release window and invalidates the old token immediately.
- A crash before or after host transition leaves a recoverable `transferPending` state rather than two accepted owners.
- A host epoch change invalidates old bindings and requires a recovery rebind.
- An uncertain side-effecting command is reconciled and is never automatically repeated.
- New customer operations remain blocked while an unresolved recovery lease exists.
- Terminal Intervention remains fail-closed across runtime restarts.
- Unauthenticated, remote-only, incomplete-evidence, and policy-rejected intervention resolution attempts fail closed.
- A project dual-approval policy works without modifying recovery or device-service core.
- Passing the Recovery Deadline retains fencing, records a breach, and cannot enable transaction commands.
- Recovery preserves operation identity, session identity, evidence ordering, and compatible cash inventory snapshots.
- Hostd-backed simulator recovery completes without using hostd reboot as transaction cleanup.
- Missing production launcher supervision or restart-window configuration fails fast when a cash device module is enabled.

## Out of scope

- CIM cash acceptance state machine.
- Resuming an interrupted customer Flow or retaining transient authentication material.
- Bank-specific financial posting reversal or advice policy.
- Embedding bank recovery decisions in hostd.

## Done when

- Every non-terminal CDM session always has exactly one durable recovery owner or a recorded Terminal Intervention outcome.
- Application and host command leases remain correlated through transfer, takeover, reconnect, and host epoch change.
- Startup cannot expose CDM availability before unresolved custody is reconciled.
- Crash and uncertainty tests prove no duplicate physical-media command dispatch.
- Simulator contracts prove staged-cash and presented-cash recovery without routine hostd reboot.

## Recommended implementation order

1. Add durable recovery-lease, transition-state, supervision-breach, and intervention-resolution persistence contracts and migrations.
2. Implement authority transition across tripley-native-hostd, xRPC/native client boundaries, and `@tripley-kit/xfs-client`.
3. Implement the framework lease coordinator and Recovery Supervisor with unit-level crash-point tests.
4. Add launcher supervision, Recovery Startup Barrier, reconnect, and runtime admission integration.
5. Add protected maintenance intervention resolution and project policy contributions.
6. Prove staged, presented, execution-unknown, deadline, restart, stale-owner, and clean-reuse paths with hostd simulator contracts.
