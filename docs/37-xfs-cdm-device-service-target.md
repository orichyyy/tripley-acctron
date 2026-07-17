# XFS CDM Device Service and Cash Investigation Foundation Target

## Status

Proposed implementation target.

## Objective

Extend `packages/xfs-device-service` with a configurable CDM cash-delivery capability while preserving open device-module extensibility. Prove staged dispense, policy-authorized presentation, take observation, abort-before-present retract, durable investigation evidence, boundary cash-unit snapshots, and crash-safe recovery against the hostd-backed XFS simulator.

The implementation must first split the existing IDC, PIN, and BCR responsibilities into registered module adapters. CDM must be added as another adapter and must not introduce a new central module switch.

## Required architectural boundaries

### XFS device module adapters

Introduce an `XfsDeviceModuleAdapterRegistry`. Each adapter owns its module-specific public port creation, descriptor contribution, health observation, input-source contribution when applicable, cancellation semantics, and disposal. `XfsDeviceService` owns transport, native-client startup, configured adapter resolution, session generation, and service-wide disposal only.

The configured adapters determine the `requiredModules` passed to `@tripley-kit/xfs-client`. IDC, PIN, BCR, CDM, and future modules such as NFC or CIM are registry contributions. Unknown configured modules fail fast with a safe configuration error.

The existing IDC, PIN, and BCR behavior must be preserved through focused adapters. CDM does not register an `InputSourceAdapter`; it contributes a cash-delivery device port.

### Configurable CDM service

CDM configuration names its logical service and operational policy. No simulator or bank logical-service name is hard-coded in core. Startup validates required native capabilities, including status and cash-unit observation, denomination, dispense, separate present, retract, and present-status reconciliation when delayed presentation is enabled.

Detailed cash-unit inventory is restricted to authorized maintenance and investigation paths. Application logs and ordinary health summaries expose only safe aggregate status.

### Cash delivery session

Only one active `CashDeliverySession` may own a configured CDM logical service. The session owns its one-use `CashDispensePlan`, physical phase, evidence sequence, recovery lease, device-lock lease, and custody outcome.

The public lifecycle distinguishes planning, dispensing, staged cash, presenting, awaiting take, retracting, reconciling, and terminal custody. Terminal outcomes are `taken`, `retracted`, `notDispensed`, and `custodyUnknown`. `presented` is never terminal.

Amounts use currency plus integer minor units. Native denomination structures remain internal. A plan is short-lived, one-use, and bound to logical service, operation, session generation, cash-unit revision, and policy version.

The session exposes an abort request rather than a generic native-command cancellation. Cancel, timeout, interrupt, route exit, and runtime shutdown preserve their distinct trigger while driving the session toward a terminal custody outcome.

Dispense, present, and retract use at-most-once dispatch by default. A timeout or disconnect after possible native dispatch records `executionUnknown`, blocks duplicate command submission, and enters reconciliation. Only explicitly classified read-only status operations may use bounded automatic retry. XRPC request identifiers are not treated as physical command idempotency.

### Presentation policy and gates

A project registers and freezes a `CashPresentationPolicy` at operation start. The policy references registered presentation gates and defines take timeout and recovery behavior. OTP, card custody, NFC, and future bank conditions are gates outside the CDM adapter.

`present()` requires a short-lived, one-use `CashPresentationAuthorization` bound to the operation, session, policy, and satisfied gates. Missing, stale, reused, expired, or mismatched authorization fails without presenting cash.

This must support at least these project sequences:

1. Stage cash, complete a mobile challenge, then present.
2. Stage cash, return and resolve card custody, then present.
3. Present and resolve cash custody before later card handling.

Gate failure before presentation requests abort and retracts staged cash. Capability checks must reject delayed-presentation policies on devices that cannot safely stage and retract.

### Flow ownership

The foreground flow stores a durable cash-session identity rather than treating an in-memory object as transaction state. A flow node cannot exit while its session is non-terminal unless ownership is atomically transferred to the recovery supervisor.

Flow timeout and interrupt hooks request abort and await terminal custody or durable transfer. A `UserInput` node used for OTP continues to use `InputSourceRegistry`; it has no CDM dependency. Business validation may re-enter that node while the same operation-owned cash session remains staged.

### Cash inventory snapshots

Cash-changing operations capture immutable `before` and `after` snapshots while holding the same exclusive logical-service lock. The complete `before` snapshot must be durably persisted before denomination or the first cash-affecting command. Failure is fail-closed.

Finalization attempts the `after` snapshot on success, rejection, cancellation, timeout, disconnect, and recovery paths. Failure after possible movement does not rewrite the physical result; it creates reconciliation evidence and marks the operation `reconciliationRequired`.

Cash-unit identity separates logical slot, optional physical cassette identity, position, type, configuration revision, and replenishment cycle. Plans and direct deltas are invalid across incompatible revisions. Snapshot facts retain source and certainty and never contain unrestricted native payloads.

### Evidence and persistence

Safety-critical sessions depend on `OperationEvidenceRecorderPort`. Before movement, the recorder durably stores canonical evidence and the corresponding EJ projection outbox record in one transaction and returns a receipt. Intent is persisted before the XFS call; completion, event, interruption, and reconciliation observations are appended afterward.

Evidence records separate interruption trigger, device execution evidence, and final custody. They carry operation-local sequence, wall and monotonic time, phase, source, certainty, safe result codes, and redacted details.

After possible cash movement, recorder failure cannot block retract, status reconciliation, or operator escalation. A local append-only `EmergencyEvidenceSpoolPort` preserves ordered safe evidence for replay and forces reconciliation status.

Standard persistence adds canonical operation evidence, cash inventory snapshots and unit observations, recovery leases, cash discrepancies, investigation artifacts, and EJ outbox records. Project formatters and projectors create versioned artifacts without mutating canonical facts.

### Recovery supervision

Every non-terminal cash session owns a persistent `CashRecoveryLease`. Acquisition and takeover use compare-and-swap fencing tokens. Stale runtime instances and connections cannot issue accepted commands after ownership changes.

Application fencing is reinforced at the native boundary by a host-backed command lease per logical service. Side-effecting calls carry operation identity, host epoch, and fencing token, which hostd validates immediately before XFS dispatch. Database ownership checks alone are not sufficient because they cannot be atomic with native command execution. Missing support in XRPC metadata, generated clients, or hostd is a prerequisite native-boundary change rather than an application-level workaround.

Each lease has a command authority mode. Transaction, recovery, maintenance, and observation modes use separate command whitelists and mutual-exclusion rules. Recovery cannot initiate a new dispense, a new transaction cannot preempt unresolved recovery, and maintenance cannot overlap either. Maintenance completion advances cash-unit revision. Simulator-control authority is test-only and must not be present in the production kiosk dependency graph.

Startup and hostd reconnect recover unresolved leases before exposing the logical service as available. Recovery uses current device status, present status, events, inventory observations, and prior evidence rather than relying on an old native command handle. An unresolved `custodyUnknown` outcome keeps the service unavailable until documented operator reconciliation.

### Reconciliation and reporting

Business-requested amount, denomination plan, device-reported result, compatible inventory delta, customer custody, and host posting remain independent. A versioned reconciliation step produces immutable discrepancies without rewriting source facts.

Project registries support bank-specific discrepancy classification, EJ formatting, transaction report projection, and external management-system payload generation. Every generated or delivered output is stored as a versioned investigation artifact with projector identity, schema version, content hash, and delivery outcome.

## Simulator automation

Add a hostd-backed CDM smoke that uses configurable hostd endpoint and CDM logical-service name. It must use `@tripley-kit/xfs-control-client` for simulator setup and customer-take automation where supported, while application commands go through `@tripley-kit/xfs-client` via `packages/xfs-device-service`.

The smoke must prove:

- `requiredModules` includes CDM through adapter resolution.
- Cash-unit configuration can be observed as a complete `before` snapshot.
- A denomination plan is bound to the observed revision.
- Dispense reaches staged state without presenting.
- A valid authorization presents cash.
- Simulator take automation produces a confirmed `taken` outcome.
- Abort before present attempts retract and records its terminal outcome.
- Before and after snapshots and safe evidence correlate to one operation.
- Connections and sessions are disposed without requiring a hostd reboot.

Failure branches that the simulator cannot deterministically induce use contract-level fake adapters with the same public session contracts.

## Required tests

- Existing IDC, PIN, and BCR behavior remains available through registered adapters.
- A custom XFS module adapter registers without modifying service core.
- Unknown and missing required module adapters fail fast.
- CDM logical-service names are configuration-driven.
- Floating-point amounts are rejected.
- Expired, reused, stale-revision, wrong-operation, and wrong-session plans are rejected.
- `before` snapshot capture or persistence failure prevents cash movement.
- Cancel or OTP timeout while staged never calls present and attempts retract.
- A custom presentation gate works without modifying CDM core.
- `present()` rejects absent or invalid authorization.
- Take timeout is recorded separately from subsequent retract success or failure.
- Missing events do not prove absence of movement; bounded status reconciliation identifies inferred certainty.
- Disconnect during an uncertain command produces reconciliation or `custodyUnknown`, not `notDispensed` by assumption.
- A transport timeout after possible dispense, present, or retract dispatch never automatically repeats the command.
- Read-only status retry is bounded and cannot be applied to a side-effecting operation by middleware configuration.
- Node exit cancels ordinary input sessions but cannot orphan a cash session.
- Recovery lease fencing rejects commands from a stale owner.
- Hostd rejects a stale fencing token before a side-effecting XFS command reaches the device manager.
- A hostd epoch change invalidates old command bindings and requires recovery rebind.
- Authority modes reject commands outside transaction, recovery, maintenance, or observation whitelists.
- Production build boundaries exclude `@tripley-kit/xfs-control-client` and simulator-control authority.
- Startup blocks new CDM operations while an unresolved lease exists.
- Safe summaries contain no PAN, track data, PIN, OTP, PIN block, unrestricted cash-unit details, or raw XFS payload.
- Snapshot and evidence persistence creates EJ outbox work atomically.
- Formatter/projector extensions create versioned artifacts without changing canonical facts.
- Hostd-backed simulator smoke completes staged dispense, authorized present, and customer take.

## Out of scope

- CIM acceptance session implementation; it follows as a separate vertical slice over the shared infrastructure.
- Bank-specific host authorization and financial posting rules.
- A universal formatter shared by all banks.
- Treating simulator behavior as proof of every production hardware timing characteristic.
- Resetting or rebooting hostd as normal transaction cleanup.

## Done when

- The XFS service has no central IDC/PIN/BCR/CDM behavior switch and resolves all configured modules through adapters.
- CDM delivery is configurable, capability-checked, session-owned, evidence-gated, recovery-safe, and extensible by project policy.
- Required unit, persistence, flow-integration, recovery, security, and extension tests pass.
- The hostd-backed smoke proves requiredModules, simulator setup, staged dispense, authorized presentation, take automation, snapshots, safe evidence, and clean reuse without hostd reboot.
- The kiosk example demonstrates a project-specific pre-presentation gate and bank-specific investigation projector without modifying core packages.
