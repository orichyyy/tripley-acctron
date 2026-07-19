# XFS CIM Cash Acceptance and Host Disconnect Protection Target

## Status

Proposed implementation target.

## Objective

Extend `packages/xfs-device-service` with a configurable CIM Cash Acceptance Session over the existing registered XFS module-adapter architecture. Prove multi-batch acceptance, immutable escrow revisions, policy-authorized CIM Physical Commit, whole-escrow rollback, per-portion custody resolution, boundary inventory snapshots, crash-safe recovery, and project extensibility against the hostd-backed XFS simulator.

Complete two prerequisites rather than embedding CIM-specific lifecycle workarounds:

- Add Cash Device Resource Group fencing and bounded Host Disconnect Protection across tripley-native-hostd, xRPC/native client boundaries, `@tripley-kit/xfs-client`, and the framework lease coordinator.
- Add a durable, registry-driven Operation Finalization Engine and migrate existing coordinator and withdrawal cleanup paths to it.

## Required architectural boundaries

### Registered CIM module adapter

CIM is an `XfsDeviceModuleAdapterRegistry` contribution. It owns CIM port creation, descriptors, capability and health observation, Cash Acceptance Session construction, safe summaries, and disposal. `XfsDeviceService` retains only transport, configured adapter resolution, `requiredModules`, session generation, and service-wide lifecycle responsibilities.

The adapter registers a CIM device port, not an `InputSourceAdapter`. Cash acceptance owns physical-media custody and cannot be modeled as ordinary `userInput`. No CIM logical-service name, simulator name, bank limit, currency, note type, input position, output position, retract area, or timeout is hard-coded in core.

Unknown adapters and malformed enabled CIM configuration fail fast. A custom future cash module continues to register without changing XFS Device Service core.

### Cash Device Resource Group

Project and hostd configuration assign CDM and CIM logical services that share a recycler mechanism to one `CashDeviceResourceGroupId`. The group covers shared transports, shutters, stackers, recycle units, retract areas, and other mutually exclusive physical paths.

Application `DeviceLockManager` and host-backed command fencing both enforce group-wide side-effect exclusion. Command leases retain logical-service-specific command whitelists, but transaction, recovery, protection, and maintenance authority cannot overlap through another service in the group. Observation sharing is allowed only by an explicit read-only whitelist.

Compound or recycle capability without a group mapping fails fast. Application and hostd expose and compare a frozen resource-group configuration hash. An unresolved CDM session, CIM session, Recovery Lease, Protection Authority, or Maintenance Intervention blocks all new cash operations in that group.

### Configurable CIM capabilities and readiness

Startup validates status, capabilities, cash-unit information, banknote types, cash-in status, `cashInStart`, repeated `cashIn`, `cashInEnd`, `cashInRollback`, configured take observation, and configured retract behavior. Enabled actions must agree with device capabilities and host authority whitelists.

Invalid safety configuration fails startup. This includes missing or duplicate logical services, missing adapters, invalid resource groups, absent production Protection Journal, unsupported return behavior, invalid finalizer dependencies, missing gates, production simulator dependencies, and command-whitelist mismatches.

Runtime provider, device, cash-unit, recovery, protection, and intervention faults degrade Deposit Entry Availability and the shared cash resource group. They do not automatically make the entire Kiosk Runtime unavailable; project readiness policy decides whether deposit is mandatory for whole-kiosk readiness.

Health output contains only module, logical service, resource group, connection/readiness classification, safe device status, recovery/protection/intervention state, journal readiness, configuration-hash agreement, and stable blocking reason codes. It excludes raw XFS extras, note identifiers, customer amounts, unrestricted unit details, and native payloads.

## Cash Acceptance Session

### Entry gate and ownership

Only one `CashAcceptanceSession` may own a CIM logical service and its Cash Device Resource Group. Before `cashInStart` can be dispatched, the Cash Acceptance Entry Gate must:

1. Acquire the application resource-group device lock.
2. Acquire host-backed transaction authority and fencing.
3. validate status, capabilities, positions, banknote types, and frozen policies.
4. Capture and durably persist a complete `before` Cash Inventory Snapshot.
5. Persist the Cash Acceptance Session.
6. Persist its CIM Cash Recovery Lease and initial physical phase.
7. Persist the `cashInStart` dispatch intent.

Failure before the final step cannot expose the input position. A possibly dispatched `cashInStart` is at-most-once and creates potential media custody requiring observation or recovery rather than automatic retry.

The CIM-specific phase model is independent from CDM and includes at least entry preparation, start dispatch, accepting, cash-in dispatch, escrow review, physical-commit dispatch, rollback dispatch, returned-awaiting-take, retract dispatch, reconciling, and terminal resolution. It does not reuse a generic CDM/CIM cash state enum.

### Multi-batch acceptance and limits

Each attempted `cashIn` cycle has a durable intent and produces an immutable `CashAcceptanceBatch`. A batch preserves accepted, refused, unfit, and uncertain media portions with safe certainty metadata. Every observed media or count change advances the immutable Cash Acceptance Snapshot revision.

An operation-frozen `CashAcceptanceLimitPolicy` combines project limits with device capabilities. It may restrict cumulative and per-batch item counts, currency-separated integer minor-unit values, batch count, currencies, denominations, note types, operation deadline, and interaction timeout.

Known violations prevent another cash-in cycle. If observed acceptance exceeds policy after media entered escrow, no result is truncated: the whole escrow is rolled back. The foundation exposes only `physicallyCommitAllEscrow` and `rollbackAllEscrow`, matching the native session contract. Selective item-level commit requires a future explicit capability and cannot be simulated by core.

### Immutable escrow revision

`CashAcceptanceSnapshot` records session identity, monotonic revision, per-note-type counts, currency-separated totals using integer minor units, refused/unfit/unrecognized/unknown counts, bound inventory revision, and a safe canonical hash. It contains no raw note images, serial numbers, unrestricted native payloads, or vendor-private customer data.

Customer confirmation, host posting evidence, and Cash Acceptance Physical Commit Authorization bind the exact same snapshot revision and hash. Any later acceptance, return, rejection, device correction, or delayed count observation advances the revision and invalidates prior confirmation and authorization.

### Physical commit policy

XFS `cashInEnd` is named CIM Physical Commit. It is distinct from Host Authorization, optional Host Financial Completion Message, advice, reversal, local database transactions, and mandatory Operation Finalization.

Each operation freezes a project-contributed `CashAcceptancePhysicalCommitPolicy` that references registered gates. A one-use `CashAcceptancePhysicalCommitAuthorization` binds operation, session, policy version, exact escrow revision/hash, gate evidence references, expiry, and use state. Missing, stale, reused, expired, wrong-operation, wrong-session, or wrong-revision authorization fails before native dispatch.

The device service does not impose one host/physical ordering. Projects may require authorization-only, authorization followed by an optional completion message, or another registered Host Posting Protocol. Gates consume only safe immutable evidence references; the CIM package does not call Host Message Service, Host Transport, or Host API Adapter.

### Media portions and custody resolution

One insertion may create multiple `DepositMediaPortion` values. Accepted escrow, refused media, unfit media, and unaccounted potential media remain separately traceable by source batch, known count, value certainty, and disposition.

Each portion terminates as `committedToInventory`, `returnedAndTaken`, `retainedByDevice`, or `custodyUnknown`. A session that never formed a portion resolves as `noMediaAccepted`. `DepositCustodyResolution` closes the session only when every known or potential portion is terminal.

Rollback completion does not mean customer take. Returned media remains `returnedAwaitingTake` until a configured trusted observation confirms take. Refused or returned portions at the customer position block physical-commit authorization, resource release, and new customer operations.

An operation-frozen `DepositReturnPolicy` names trusted take observations, take timeout, permitted retract destination, and intervention behavior. Timeout may trigger one at-most-once retract under policy. Confirmed retract into a known area produces `retainedByDevice`; uncertain retract or conflicting observations require reconciliation or Terminal Intervention. Production supplies no implicit take timeout or retract area.

### Abort and uncertainty

Customer cancellation, interaction timeout, operation deadline, route exit, and runtime shutdown append distinct Abort Requests. They prohibit new acceptance and physical commit but never assert native cancellation or returned media.

`requestAbort` returns only `closedNoMediaAccepted`, `recoveryOwnershipAccepted`, or `alreadyTerminal`. A best-effort native cancellation is execution evidence, not custody evidence. A possibly dispatched cash-in, physical commit, rollback, or retract is never automatically repeated.

After abort, only observation and evidence-backed custody-reducing actions are allowed. Foreground Flow exits after a terminal no-media result or durable ownership transfer, not after a Promise rejection or rollback request. Returned media remains supervised through take or retention.

## Inventory, evidence, and reconciliation

Escrow revision and Cash Inventory Revision are separate. Physical-commit intent binds the exact escrow revision, the resource group's before inventory revision, and expected denomination deltas.

Confirmed CIM Physical Commit or device retention captures and persists a complete after snapshot, advances the resource-group Cash Inventory Revision, and invalidates old CDM denomination plans and CIM observations. A potentially inventory-changing execution-unknown action blocks the group until reconciliation establishes a new authoritative generation.

`cashInEnd` result cash-unit information is evidence but does not replace the independently captured after snapshot. Snapshot failure after movement preserves the physical outcome, creates reconciliation evidence, and keeps the group degraded. Incompatible revisions and non-conserving counts produce immutable Cash Discrepancies rather than adjusted source facts.

All intents, batch results, snapshot revisions, interruption triggers, native certainty, portion transitions, protection imports, and terminal outcomes use `OperationEvidenceRecorderPort` and safe summaries. Recorder and EJ outbox atomicity, Emergency Evidence Spool behavior, investigation projectors, and bank-specific report extensions reuse the CDM cash-investigation foundation.

## Recovery supervision

Every non-terminal Cash Acceptance Session owns a persistent Cash Recovery Lease containing module, logical service, Cash Device Resource Group, operation/session identity, phase, evidence sequence, deadline, owner, authority, host epoch, and fencing token.

Foreground transfer to recovery uses the no-release-window authority transition. Recovery authority may observe, roll back confirmed escrow, wait for customer take, perform policy-authorized retract, and reconcile a physical commit that may already have reached the device.

Recovery never initiates a new `cashInStart`, `cashIn`, or CIM Physical Commit. A crash after customer or host approval but before physical-commit dispatch returns escrow. A possibly dispatched physical commit is observed first: confirmed commit is preserved as fact, confirmed escrow may be rolled back, and unresolved certainty enters Terminal Intervention. Physical-commit authorization becomes invalid when transaction authority ends.

Application recovery does not retain or reconstruct transient authentication, customer UI confirmation, PIN, or raw host-message material. Host posting advice, reversal, optional financial completion, and account correction remain project business recovery concerns.

## Host Disconnect Protection

### Authority and trigger

Hostd adds internal `protection` authority for a Cash Device Resource Group. Owner transport loss enters `suspect`; only the same runtime identity may prove and rebind its existing lease during the phase-specific grace window. Grace expiry atomically activates protection, advances fencing, and permanently stales the former owner.

Heartbeat interval, suspect deadline, and grace windows are explicit production configuration. Customer-position media continues its frozen take timeout instead of immediate reclamation. A native command already executing in hostd is allowed to complete or become execution-unknown before any non-conflicting protection action is selected.

Protection allows a closed host-validated vocabulary: wait, observe, close shutter, rollback escrow, eject card, retain card, retract media, or enter intervention. Phase and capability validation prohibit transaction continuation. Protection never dispenses, presents, starts cash acceptance, initiates CIM Physical Commit, resumes Flow, or sends financial messages.

### Declarative policy and plugin seam

The initial implementation uses deployment-frozen declarative policy per resource group and module. Policy identity, version, and hash are exposed through runtime information and cannot change while custody exists.

A `ProtectionPolicyPlugin` contract is reserved for policies the configuration language cannot express. It receives only safe typed context and returns one action from the closed vocabulary. It has no direct XFS, network, filesystem, host-message, or unrestricted-payload access. No dynamic Rust DLL ABI or WASM runtime is required in this target; illegal decisions, plugin failure, or unknown phase fail closed into intervention.

### Durable Protection Journal

Production protection requires a hostd-owned SQLite `ProtectionJournalStore`; the memory adapter is test-only. Enabling protection without a writable durable store fails startup. Hostd owns schema migrations and uses transactionality suitable for activation and dispatch barriers.

Protection activation and fencing advance are persisted together. Every side-effecting action has a unique ID and durable intent before XFS dispatch. Restart sees incomplete dispatch as execution-unknown and never repeats it. Unresolved, unknown, and intervention records cannot be automatically deleted. Terminal records become retention-eligible only after application durable-import acknowledgement.

If the journal cannot persist a new intent, hostd keeps resource-group fencing, allows safe observation, reports `protectionJournalUnavailable`, and enters intervention without dispatching an unrecorded side effect. Firmware-initiated automatic behavior is later observed as device evidence and is not represented as a host action.

The application imports journal records into canonical operation evidence and acknowledges the durable import. The journal is not the business database or EJ. This target intentionally does not implement general XFS event replay; missing non-journaled history requires current-state reconciliation and cannot manufacture custody certainty.

## Operation Finalization Engine

Every operation freezes and durably executes an `OperationFinalizationPlan` regardless of success, failure, cancel, timeout, or recovery transfer. The plan contains registered finalizer ID, version, dependencies, criticality, idempotency identity, and failure policy.

Add `OperationFinalizerRegistry` and `OperationFinalizationRunner` outside the CIM package. The runner validates missing contributions, version mismatch, and dependency cycles; persists `pending`, `running`, `succeeded`, `retryPending`, and `failedTerminal`; and resumes incomplete plans after runtime restart without rerunning successful steps.

Finalizer criticality is `custodyCritical`, `closureRequired`, `detachedDurable`, or `runtimeCleanup`. Custody-critical failure blocks physical resource release and operation admission. Closure-required work must succeed or establish durable retry before record closure. Detached durable work continues through outbox/retry. Runtime cleanup failure is recorded without rewriting physical or financial facts.

Migrate coordinator and withdrawal `finally` cleanup into registered finalizers. Framework, XFS device service, and project packages use the same registry. CIM contributes custody/recovery-transfer, after-snapshot, evidence, and device-session finalizers. Scoped-store reset, UI/prompt/audio cleanup, input cancellation, audit/outbox, and transaction closure remain focused contributions rather than one broad function.

A Host Posting Protocol may optionally contribute a Host Financial Completion Message finalizer. Authorization-only projects omit that contribution while still running complete local Operation Finalization. Advice and reversal are separate project actions.

## Coordinated repository changes

### tripley-acctron

- Add CIM adapter, contracts, policies, sessions, portions, snapshots, custody resolution, safe summaries, health, recovery, persistence, and tests under focused `packages/xfs-device-service` modules.
- Extend device locking, recovery leases, inventory revision, startup barrier, maintenance, evidence, migrations, and project configuration for Cash Device Resource Groups and CIM.
- Add the generic finalization registry, runner, durable store, migrations, and existing-cleanup migration in focused kiosk-runtime/kiosk-base modules.
- Add project extension examples for commit gates, limits, return policy, finalizers, health/readiness, and investigation projections without core changes.

### tripley-kit

- Extend `@tripley-kit/xfs-client` command-lease contracts for resource-group identity, protection state, journal query/import acknowledgement, configuration hash, and safe status while preserving configurable CIM logical services and `requiredModules`.
- Keep `@tripley-kit/xfs-control-client` test-only and add only simulator controls required to stage batches, refused media, take, disconnect, journal failure, and device outcomes.

### tripley-native

- Extend hostd and native/xRPC boundaries with resource-group lease exclusion, Protection Authority, suspect/grace transitions, declarative policy validation, command whitelists, persistent SQLite Protection Journal, safe journal query/acknowledgement, and startup capability/configuration validation.
- Preserve host epoch, at-most-once dispatch, stale-owner rejection, and no-release-window fencing across transaction-to-protection activation.
- Keep bank posting, Flow, transaction recovery, and unrestricted plugins outside hostd.

## Simulator automation

Add opt-in hostd-backed CIM and protection contract tests using configurable endpoint, CIM/CDM/IDC logical-service names, resource-group mapping, journal path, heartbeat/grace settings, and test policies. Application commands use `@tripley-kit/xfs-client` through `packages/xfs-device-service`; device preparation and customer actions use `@tripley-kit/xfs-control-client` only in test tooling.

The smoke must prove:

- Adapter resolution adds CIM to `requiredModules` without a central switch.
- Before snapshot and recovery ownership exist before the input position can accept media.
- Multiple staged batches produce immutable revisions and currency-separated safe totals.
- Refused and accepted media become separate portions.
- Exact-revision authorization physically commits all escrow and advances shared inventory revision.
- Rollback reaches returned-awaiting-take and only a simulator take produces `returnedAndTaken`.
- Return timeout retracts to a known area when configured.
- Cancel and interaction timeout preserve their triggers and transfer unresolved custody.
- Grace-window same-owner reconnect does not activate protection.
- Grace expiry fences the owner and executes only the configured protective action.
- In-flight command uncertainty prevents conflicting or duplicate protection dispatch.
- Protection Journal survives hostd restart and incomplete intent is not repeated.
- Shared-resource fencing rejects CDM dispense while CIM recovery or protection owns the group.
- The logical services can be reused after terminal cleanup without rebooting hostd.

## Required tests

- CIM logical service, positions, limits, currencies, timeouts, return behavior, and resource group are configuration-driven.
- A custom XFS module, physical-commit gate, limit policy, finalizer, readiness policy, and investigation projector work without core modification.
- Invalid safety configuration fails fast while runtime device failure yields safe deposit/resource-group degradation.
- Missing before snapshot, evidence receipt, recovery lease, device lock, or host authority prevents `cashInStart`.
- A possibly dispatched `cashInStart` is reconciled and never automatically repeated.
- Multiple cash-in batches advance revisions; a changed revision invalidates customer confirmation and physical-commit authorization.
- Floating-point amounts, cross-currency summation, unsupported note types, and policy-limit truncation are rejected.
- Over-limit observed escrow rolls back all escrow rather than reporting partial commit.
- Absent, stale, reused, expired, wrong-operation, wrong-session, and wrong-revision authorizations cannot call `cashInEnd`.
- CIM Device Service performs no host transport or host-message call.
- Authorization-only and authorization-plus-financial-completion projects both run all local finalizers.
- Accepted, refused, unfit, retained, returned-and-taken, and unknown portions remain independently represented.
- Return command success without take observation remains non-terminal.
- Unresolved returned media blocks physical commit, resource release, and new cash operations.
- Cancel, timeout, deadline, route exit, and shutdown remain distinct from command evidence and custody outcome.
- Native cancellation or Promise rejection never proves no media was accepted.
- Physical commit, rollback, and retract execution-unknown paths are not retried.
- Recovery rolls back confirmed escrow but never initiates an undispatched physical commit.
- Confirmed physical commit and host posting outcomes remain independent.
- CIM inventory change invalidates same-group CDM denomination plans.
- Snapshot mismatch creates a discrepancy without rewriting facts.
- Resource-group fencing rejects cross-module stale and concurrent side effects at hostd dispatch.
- Suspect grace allows only same-owner proof; protection activation permanently stales the old token.
- Protection command whitelists reject dispense, present, new acceptance, physical commit, arbitrary native command, and host-message activity.
- Journal intent precedes protection dispatch; restart does not repeat execution-unknown actions.
- Journal failure permits observation but no new side effect and retains intervention fencing.
- Protection records contain no PIN, track data, raw note identifiers, customer payload, unrestricted XFS extras, or raw native payload.
- Finalization dependency cycles and missing/version-mismatched contributions fail before operation admission.
- Successful finalizers are not rerun after restart; incomplete idempotent steps resume safely.
- Custody-critical finalizer failure blocks resource release; detached durable work does not rewrite operation outcome.
- Production dependency boundaries exclude simulator control and memory journal adapters.
- Hostd-backed tests complete commit, rollback/take, rollback/retract, disconnect protection, journal restart, clean release, and reuse without routine hostd reboot.

## Out of scope

- A complete customer deposit Flow, account selection UI, receipt design, or bank-specific posting matrix.
- A universal ordering of Host Authorization, optional Host Financial Completion Message, advice, reversal, and CIM Physical Commit.
- Selective item-level physical commit without an explicit provider capability.
- Resuming customer interaction or preserving transient authentication in recovery or hostd.
- General XFS event replay/cursor infrastructure.
- Dynamic Rust DLL plugins or a WASM plugin runtime; this target reserves and tests the closed decision contract only.
- Hostd access to Host Message Service, Host Transport, application transaction database, EJ formatter, or bank business policy.
- Treating simulator timing as proof of every production recycler implementation.

## Recommended implementation order

1. Add Cash Device Resource Group contracts and migrate application locks, recovery leases, inventory revisions, and configuration validation.
2. Extend hostd/xRPC/xfs-client leases with group exclusion, protection authority, suspect/grace transitions, and safe status contracts.
3. Add the hostd SQLite Protection Journal and declarative protection policy executor with crash-point tests.
4. Add Operation Finalizer Registry, durable plan/store/runner, migrations, and migrate existing cleanup paths.
5. Add CIM adapter, capability validation, session persistence, entry gate, batches, escrow snapshots, and limit policies.
6. Add media portions, physical-commit policy/authorization, rollback, take/retract, abort, evidence, inventory, and recovery integration.
7. Add hostd-backed simulator contracts for normal, failure, reconnect, protection, restart, stale-owner, and shared-resource paths.
8. Add project extension examples, complete repository builds/tests, commit each repository, and publish changed public npm/crate packages in dependency order when approved.

## Done when

- CIM is a configurable registered module adapter with no core module switch or hard-coded logical-service name.
- Every possible accepted media portion has one durable owner until an independently evidenced terminal disposition or intervention.
- Exact-revision policy authorization is required for whole-escrow CIM Physical Commit, while optional Host Financial Completion Message remains a project contribution.
- Shared CDM/CIM hardware is fenced as one physical resource at both application and host dispatch boundaries.
- Host Disconnect Protection safely handles lost owners using a closed action vocabulary and durable journal without taking over bank recovery policy.
- Every operation uses resumable registered finalizers, including authorization-only projects and all failure paths.
- Unit, persistence, crash-point, recovery, security, extension, build, and hostd-backed simulator tests pass across affected repositories.
- Normal completion, cancellation, timeout, disconnect, hostd restart, protection, intervention, and clean reuse require no routine hostd reboot.
