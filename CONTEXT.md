# Tripley Acctron Kiosk Framework

This context defines the language for building kiosk applications on top of Tripley native capabilities, XFS devices, Flow, Command, UI, and project extension packages.

## Language

**Kiosk Application**:
A project-specific customer-facing application assembled from framework packages, project flows, command handlers, UI routes, device plugins, and configuration.
_Avoid_: ATM app, terminal shell

**Tripley Native Host**:
The out-of-process host that exposes native desktop and optional provider capabilities over Tripley xRPC.
_Avoid_: backend, daemon, service process

**Tripley Native SDK**:
The TypeScript client API used by the framework to access required host capabilities such as runtime, window, display, SQLite, TTS, and secure storage.
_Avoid_: native lib, browser bridge

**XFS Provider**:
The optional native capability provider for CEN/XFS logical services and device commands.
_Avoid_: XFS SDK, device driver

**XFS Control Plane**:
The simulator automation surface used to prepare device state, inject events, and complete pending commands during tests.
_Avoid_: test device API, simulator API

**Simulator Contract Test**:
An opt-in verification of framework device behavior against a running XFS Provider while the XFS Control Plane supplies deterministic device actions.
_Avoid_: unit test, default test, simulator smoke

**Logical Service Name**:
The configured CEN/XFS service name that identifies a simulator or hardware-backed device endpoint.
_Avoid_: device id, port name

**Device Service**:
A framework-owned service that translates a device capability into framework ports, health checks, events, and input source adapters.
_Avoid_: raw XFS client, native extension

**XFS Device Module Adapter**:
A focused adapter that contributes one XFS module's port factory, device descriptor, health/status behavior, input sources, and cancellation semantics to XFS Device Service through a registry.
_Avoid_: Module branch in XFS Device Service, raw generated client exposure

**Device Port**:
The narrow framework interface consumed by Flow, Command, Condition, and InputSource adapters for a specific device capability.
_Avoid_: service client, XFS module client

**Input Source Adapter**:
The adapter that lets a `userInput` node start, race, cancel, and summarize a concrete input source without knowing the underlying device implementation.
_Avoid_: input handler, device executor

**Project Device Plugin**:
A project-owned extension that registers devices, input source adapters, health checks, conditions, and configuration without modifying core framework packages.
_Avoid_: custom core patch, app-specific device hack

**Secure Input**:
User input whose raw value must not be exposed to UI state, logs, traces, tests, or business code outside a safe encrypted or tokenized result.
_Avoid_: PIN text, masked plain input
**Kiosk Runtime Mode**:
An explicit startup selection of the capability composition used by a kiosk application. A mode never silently changes while an operation is active; choosing another mode creates a new runtime.
_Avoid_: Automatic fallback, transparent device fallback
**Withdrawal Entry Method**:
The immutable way a withdrawal operation begins, selected from the entry methods contributed by the active project. Changing the method ends the current operation and starts another.
_Avoid_: Input fallback, device fallback

**Entry Method Contribution**:
A project-provided withdrawal entry option that defines how access credentials are acquired and when that option is available.
_Avoid_: Core entry type, device mode

**Runtime Readiness**:
Whether the kiosk foundation is able to create and govern operations, independent of whether every contributed entry method is currently available.
_Avoid_: Device health, entry availability

**Entry Method Availability**:
Whether one contributed withdrawal entry method can begin a new operation under the current capabilities and business policy.
_Avoid_: Runtime readiness, global device status

**Authentication Plan**:
The immutable set and order of authentication challenges required for one operation after access credential acquisition.
_Avoid_: Fixed PIN step, mutable authentication flow


**Access Credential**:
A safe business representation that identifies the credential acquired through a withdrawal entry method without exposing its raw card or QR content.
_Avoid_: Raw card data, raw QR payload, credential value
**Customer Operation**:
An exclusive customer-facing attempt governed by one kiosk runtime from acceptance through complete cleanup. A runtime has at most one active customer operation.
_Avoid_: Device session, UI session, concurrent transaction

**Withdrawal Operation**:
A customer operation for one withdrawal attempt, beginning when its start command is accepted before credential acquisition. It has one immutable entry method and owns all activity performed for that attempt.
_Avoid_: Page session, device session, transaction screen

**Sensitive Acquisition Material**:
Raw card, QR, or equivalent credential content that exists only while an entry method is being verified and is never part of durable or observable operation state.
_Avoid_: Access Credential, input value, credential record
**Operation View State**:
The safe, UI-facing projection of one withdrawal operation, containing everything needed to render its current screen without exposing device sessions or sensitive acquisition material.
_Avoid_: Flow state, route state, component state
**Credential Assessment**:
The safe business evaluation produced after access credential verification, containing the credential reference, risk result, and required forms of authentication without executable workflow content.
_Avoid_: Authentication plan, remote flow definition

**Authentication Requirement**:
A declarative request for a recognized form of authentication, evaluated against local bank policy before it can become part of an authentication plan.
_Avoid_: Flow node, executable challenge

**Authentication Challenge**:
A locally approved way to satisfy an authentication requirement, such as online PIN, reservation secret, or mobile confirmation.
_Avoid_: Authentication requirement, arbitrary subflow
**Kiosk Runtime**:
An isolated application composition that governs readiness and at most one active customer operation under one explicitly selected runtime mode and project contribution set.
_Avoid_: Hostd process, browser page, global application singleton
**Runtime Reboot**:
The explicit replacement of an entire kiosk runtime after its active operation and owned resources have been safely closed. It is the boundary for changing runtime mode or reconstructing a lost native connection.
_Avoid_: Operation retry, automatic reconnect, adapter swap
**Media Custody**:
The kiosk's unresolved responsibility for physical customer media accepted during an operation, ending only when the media is returned, retained under policy, or explicitly classified as unknown for intervention.
_Avoid_: Card data, device session, input ownership

**Cash Delivery Session**:
The exclusive, operation-bound device session that owns one physical cash movement from dispense initiation until cash is taken, retracted, confirmed not dispensed, or classified custody unknown.
_Avoid_: Stateless dispense call, financial withdrawal result, reusable device request

**Cash Dispense Plan**:
A short-lived, one-use reference to a device-owned native denomination bound to one logical service, operation, session generation, cash-unit revision, currency, and integer minor-unit amount.
_Avoid_: Mutable denomination bytes, reusable mix, floating-point amount

**Cash Custody**:
The kiosk's unresolved responsibility for notes that may have left cash units, ending only when cash is taken, retracted into a known area, confirmed not dispensed, or classified unknown for intervention.
_Avoid_: Customer debit state, denomination plan, cash-unit inventory

**Terminal Intervention**:
A state in which unresolved physical-media custody or equivalent safety risk prevents new customer operations until an authorized recovery action occurs.
_Avoid_: Validation failure, ordinary device degradation
**Operation Deadline**:
The absolute time limit for a customer operation's business activity, unaffected by validation reentry or ordinary user interaction.
_Avoid_: Node timeout, renewable session timeout

**Interaction Timeout**:
The bounded idle period allowed for the current customer interaction stage, renewable by valid activity but never beyond the operation deadline.
_Avoid_: Operation deadline, service-call timeout

**Attempt Budget**:
The policy-controlled number of rejected attempts allowed for one validation or authentication requirement within an operation.
_Avoid_: Timeout retry, unlimited reentry
**Speech Prompt**:
A catalog-approved spoken presentation of a safe customer prompt, governed by the current accessibility profile and never constructed from unrestricted text.
_Avoid_: Arbitrary TTS text, device announcement
**Recorded Prompt**:
A bank-approved, versioned audio presentation of a catalog prompt, referenced by a trusted asset identity rather than an arbitrary path or URL.
_Avoid_: TTS output, arbitrary audio file

**Prompt Presentation**:
The coordinated visual and audio rendering of one semantic customer prompt under bank, locale, accessibility, priority, and lifecycle policy.
_Avoid_: Direct audio playback, component speech
**Custody Reconciliation**:
The startup recovery process that compares an unfinished operation's recorded media responsibility with current device state and resolves only cleanup, never resumes customer business steps.
_Avoid_: Flow resume, transaction replay, ledger reset

**Host Message Codec**:
A versioned, profile-driven encoder and decoder that translates between structured host-message fields and one wire representation without opening connections or deciding delivery behavior.
_Avoid_: Host client, socket protocol, REST service

**Host Message Service**:
The pure application-facing facade that resolves frozen profiles and registered codecs to pack, unpack, validate, and safely summarize host messages without performing transport or persistence.
_Avoid_: Host transport, transaction repository, business host client

**Host Field Value**:
A lossless wire-level value represented only as a string, byte array, or bounded repeating group; numeric-looking fields remain strings so leading zeroes and arbitrary precision are preserved.
_Avoid_: JavaScript number, business amount, arbitrary JSON value

**Partial Host Message**:
A distinct decode outcome containing only fully decoded and validated leading fields plus a safe descriptor of the field and byte position where input became incomplete.
_Avoid_: Complete host message, padded truncated field, best-effort business response

**Host Message Failure**:
A safe typed protocol outcome for an expected packing or decoding failure, identified by a stable code and structural location without raw bytes, sensitive values, or unrestricted underlying exception text.
_Avoid_: Internal invariant exception, raw codec error, unknown failure string

**Host Message Profile**:
A source-controlled, versioned declaration in the kiosk application's `script` source tree that defines one host wire contract and is statically registered when the application runtime is composed.
_Avoid_: Runtime-downloaded schema, disk-loaded script, mutable host configuration

**Host Message Definition**:
One immutable request, response, or advice wire schema within a versioned Host Message Profile, selected by an exact profile ID, profile version, and message ID reference.
_Avoid_: Guessed MTI handler, latest profile, runtime-inherited message

**Field Codec Contribution**:
A trusted, statically registered application or plugin module that implements a named custom field transformation referenced declaratively by a host message profile.
_Avoid_: Inline profile function, evaluated script string, dynamic plugin download

**Legacy Field Codec**:
A field codec contribution for a legacy code page or private byte transformation whose support is defined by an explicit version and verified golden byte vectors rather than environment defaults.
_Avoid_: Default system encoding, guessed TextDecoder label, unversioned character map

**Fixed-Field Host Message**:
A host-message wire representation whose fields are encoded in configured order and length without an ISO 8583 bitmap, even when its field meanings resemble ISO 8583.
_Avoid_: Standard ISO 8583, special ISO 8583

**Fixed Repeating Group**:
A bounded sequence of fixed-layout items whose count and optional total wire area are declared by a fixed-field host message profile.
_Avoid_: Unbounded array, LLVAR field, dynamic object graph

**ISO 8583 Message Profile**:
A versioned application-owned declaration of MTI, bitmap, data-element presence, length, encoding, validation, and classification rules consumed by the generic ISO 8583 codec engine.
_Avoid_: Universal bank field table, fixed-field host message

**Message Framing**:
The rules that locate complete message bodies in a byte stream, including fixed headers, length prefixes, packet reassembly, and incomplete-frame handling.
_Avoid_: Field decoding, transport connection

**Host Transport**:
The connection and delivery mechanism that exchanges framed bytes with a host, such as TCP or WebSocket, independently of the message codec.
_Avoid_: Message format, field profile

**Host API Adapter**:
An adapter that maps a business host operation to an API interaction such as HTTP request method, path, headers, JSON body, status, and response mapping.
_Avoid_: ISO 8583 codec, HTTP message format

**Safe Host Message Record**:
A persistable transaction-timeline projection containing profile identity, direction, status, timing, correlation metadata, wire size, result summary, and only policy-approved masked or tokenized fields.
_Avoid_: Raw wire message, complete decoded field bag, diagnostic hex dump

**Encrypted Host Message Archive**:
An optional, explicitly enabled bank capability that stores complete host wire messages under separate encryption, access, retention, and audit policy when regulation requires it.
_Avoid_: Transaction message repository, application log, default diagnostics
### Operation Evidence Record

An append-only, safely redacted fact describing an operation intent, completion, device event, interruption, or reconciliation observation. Evidence records distinguish the interruption trigger from device execution evidence and the final physical custody outcome.

### Cash Inventory Snapshot

An immutable, point-in-time observation of cash-unit counters and status captured at a named transaction boundary. Cash-changing transactions capture a `before` snapshot before the first cash-affecting action and an `after` snapshot in finalization regardless of success or failure. A missing or partial snapshot is recorded explicitly rather than inferred.

### Cash Inventory Observation

The structured per-cash-unit data inside a cash inventory snapshot. It uses stable logical identifiers and typed counters; project-specific EJ text and management-system reports are projections of this data, not the source of truth.

### Investigation Projection

A project-owned transformation from canonical transaction evidence and cash inventory snapshots into a bank-specific EJ entry, database report model, or external management-system message. Projection failures do not alter the preserved canonical evidence.

### Cash Movement Evidence Gate

The fail-closed boundary that requires a complete and durably persisted `before` cash inventory snapshot before the first cash-affecting command may start. Failure to capture or persist the later `after` snapshot cannot rewrite the physical transaction outcome; it marks the operation as requiring reconciliation.

### Operation Evidence Recorder

A persistence port used by safety-critical sessions to append canonical operation evidence and receive a durable receipt. Its implementation owns the transaction that stores canonical evidence and an EJ projection outbox; device modules do not depend on a database, EJ file format, or bank reporting protocol.

### Emergency Evidence Spool

A local append-only fallback used only after physical cash movement may have begun and the authoritative evidence recorder is unavailable. It preserves ordered, safely redacted evidence while custody compensation continues, and is replayed into the authoritative store during recovery rather than serving as a second business database.

### Custody Terminal Outcome

The final physical-media result required before a safety-critical device session may release ownership: `taken`, `retracted`, `notDispensed`, or `custodyUnknown`. A staged, presenting, waiting-for-take, retracting, or reconciling state is not terminal.

### Recovery Supervisor

A durable runtime owner that can atomically accept responsibility for a non-terminal physical-media session when the foreground flow cannot remain active. It continues compensation and reconciliation independently of the originating flow node and preserves the original evidence sequence.

### Abort Request

A recorded request to stop future business actions and move a physical-media session toward a safe terminal outcome. It is not equivalent to cancelling an in-flight native command and does not prove that the device performed no physical action.

### Cash Presentation Policy

A project-owned, operation-frozen policy naming the registered gates that must be satisfied before staged cash may be presented. It also defines take timeout and post-presentation recovery behavior without coupling the CDM adapter to card, OTP, NFC, or other business concepts.

### Presentation Gate

A registered condition that contributes safe evidence that a project-specific prerequisite has been satisfied, such as a mobile challenge or resolved card custody. Gate identifiers are open for project extensions and are evaluated by the cash presentation policy.

### Cash Presentation Authorization

A short-lived, one-use authorization bound to an operation, cash delivery session, frozen policy, and satisfied presentation gates. `present()` requires this authorization so a custom flow cannot bypass mandatory safety gates.

### Investigation Artifact

An immutable, versioned record of EJ text, a management-system report, receipt data, or another investigation projection that was actually generated or delivered. It records projector identity and version, schema version, content hash, generation time, and delivery outcome without replacing canonical transaction evidence.

### Cash Unit Identity

The identity tuple used to correlate a cash-unit observation across snapshots. It separates a stable logical slot from an optional physical cassette identity and from the replenishment/configuration revision under which counters and denomination are valid.

### Cash Unit Revision

The configuration or replenishment generation of a logical cash-unit slot. A denomination plan is valid only for its bound revision, and snapshots with different revisions cannot be treated as a direct transaction delta without reconciliation.

### Cash Movement Reconciliation

A versioned comparison of business-requested or declared value, device-planned and device-reported value, compatible inventory observations, customer custody outcome, and host posting outcome. It preserves each fact's source and certainty instead of forcing them into one amount or status.

### Cash Discrepancy

An immutable finding that two or more independently observed cash or posting facts do not agree under a registered reconciliation policy. Project resolvers may classify and report the discrepancy but cannot rewrite its source evidence.

### Cash Delivery Session

The CDM-specific owner of denomination planning, dispensing to staging, authorized presentation, take observation, retract, and custody reconciliation. Its lifecycle is distinct from deposit acceptance even though both use shared evidence infrastructure.

### Cash Acceptance Session

The CIM-specific owner of media acceptance, escrow, counting, commit, return, retract, and custody reconciliation. Escrowed media is not treated as committed inventory, and the session does not reuse the CDM delivery state model.

### Cash Recovery Lease

A durable ownership record for a non-terminal CDM or CIM session. It stores the last known physical phase, operation and logical-service identity, evidence sequence, recovery deadline, owner instance, and a monotonically increasing fencing token so only one runtime may issue recovery commands.

### At-Most-Once Device Dispatch

The default dispatch rule for physical-media commands such as dispense, present, retract, commit, return, and retain. Once a command may have reached the native boundary, a timeout or disconnect creates an execution-unknown state that must be reconciled rather than automatically retried.

### Execution Unknown

A command outcome used when transport evidence cannot establish whether a side-effecting native command executed. It preserves the original intent and dispatch evidence, blocks duplicate dispatch, and requires device-state reconciliation before the operation can progress.

### Host-Backed Device Command Lease

The native-host execution guard for a logical service. Side-effecting commands carry an operation identity, host epoch, and fencing token; hostd validates them immediately before dispatch to the XFS manager so a stale application instance cannot act after recovery ownership changes.

### Device Command Authority

The mode and command whitelist attached to a host-backed logical-service lease. Transaction, recovery, maintenance, observation, and test-only simulator-control authorities have different permissions and explicit mutual-exclusion rules.

### Recovery Startup Barrier

The state that prevents a replacement Kiosk Runtime from accepting customer operations until every unresolved physical-media responsibility from an earlier runtime has reached a terminal outcome or Terminal Intervention.
_Avoid_: Normal startup check, background recovery, automatic transaction resume

### Runtime Restart Window

The project-defined maximum interval between loss of a Kiosk Runtime and a replacement runtime taking recovery ownership. It bounds recovery delay without transferring business recovery policy to the Tripley Native Host.
_Avoid_: Hostd recovery timeout, transaction timeout, unlimited restart delay

### Kiosk Launcher

The deployment supervisor that starts, monitors, and replaces a Kiosk Runtime and reports the previous runtime instance outcome. It is outside both the Kiosk Runtime and the Tripley Native Host.
_Avoid_: Hostd watchdog, browser helper, recovery supervisor

### Recovery Authority Transition

The owner-authorized replacement of transaction command authority with recovery authority for the same operation, session, and logical service while advancing its fencing token without an unowned command window.
_Avoid_: Lease release and reacquire, recovery takeover, authority flag update

### Recovery Deadline

The escalation threshold by which a Recovery Supervisor is expected to resolve physical-media custody. Passing it records a supervision breach and requires Terminal Intervention but does not release command fencing or prohibit evidence-backed custody-reducing action.
_Avoid_: Lease expiry, command timeout, compensation stop time

### Maintenance Intervention Session

The authenticated, locally controlled session that takes fenced maintenance authority from a Recovery Supervisor to investigate and resolve Terminal Intervention under project policy.
_Avoid_: Remote clear command, admin screen, maintenance flag

### Intervention Resolution

An append-only operator reconciliation outcome that records how an intervention was investigated and whether the device may return to service without rewriting the original custody, deadline, or execution evidence.
_Avoid_: Error reset, status overwrite, intervention deletion

### Recovery Transfer Boundary

The point at which foreground business ownership must move to the Recovery Supervisor because physical cash has moved or cannot be proven not to have moved. UI exit, cancellation, and timeout are interruption triggers rather than substitutes for this physical-risk boundary.
_Avoid_: Flow exit hook, cancellation boundary, screen lifecycle
