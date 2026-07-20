# Phase-aware Host Cash Protection Target

## Goal

Replace the single-action disconnect safeguard with a host-owned, phase-aware CDM/CIM protection state machine that remains authoritative across application disconnect and hostd restart, runs until Cash Custody reaches a terminal outcome, and never expands Protection Authority into customer business behavior.

This target covers cash protection only. IDC eject/retain protection remains a separate future target with its own Media Custody lifecycle.

## Safety model

- Tripley Native Host is the sole authority for Protection Phase.
- Phase is derived from durably recorded authorized command dispatch, native outcomes, and relevant device observations.
- Application workflow state, routes, Flow nodes, and unverified application reports cannot mutate phase.
- Every Cash-Affecting Command has a durable operation-scoped intent before native dispatch.
- Journal failure prevents cash-affecting dispatch but does not disable read-only status and information commands.
- Protection ends only with a Custody Terminal Outcome or Terminal Intervention, not merely a successful rollback or retract request.
- Protection Authority cannot dispense, present, start new cash acceptance, physically commit CIM escrow, post host financial messages, or resume Flow.

## Protection configuration v2

Version 2 is a breaking internal-development schema. Hostd rejects the legacy `disconnectAction` shape and does not infer compatibility behavior.

```json
{
  "schemaVersion": 2,
  "journalPath": "data/xfs-protection.db",
  "resourceGroups": [
    {
      "id": "cash-transport-1",
      "members": [
        { "logicalService": "CDM", "module": "cdm" },
        { "logicalService": "CIM", "module": "cim" }
      ],
      "protectionProfileIds": ["standard", "accessible"]
    }
  ],
  "profiles": [
    {
      "id": "standard",
      "version": "1",
      "suspectGraceMs": 1000,
      "customerAccessTimeoutMs": 30000,
      "commandSettlementTimeoutMs": 30000,
      "actions": {
        "cdm.cashHeld": {
          "kind": "cdmRetract",
          "logicalService": "CDM",
          "outputPosition": 512,
          "retractArea": 2,
          "index": 1,
          "timeoutMs": 30000
        },
        "cdm.customerAccessible": {
          "kind": "waitUntilDeadlineThenCdmRetract",
          "logicalService": "CDM",
          "outputPosition": 512,
          "retractArea": 2,
          "index": 1,
          "timeoutMs": 30000
        },
        "cim.accepting": {
          "kind": "cimRollbackThenAwaitTake",
          "logicalService": "CIM",
          "timeoutMs": 30000
        },
        "cim.escrowHeld": {
          "kind": "cimRollbackThenAwaitTake",
          "logicalService": "CIM",
          "timeoutMs": 30000
        },
        "cim.customerAccessible": {
          "kind": "waitUntilDeadlineThenCimRetract",
          "logicalService": "CIM",
          "outputPosition": 512,
          "retractArea": 2,
          "index": 1,
          "timeoutMs": 30000
        }
      }
    }
  ]
}
```

The concrete parser may normalize the JSON into smaller internal types, but the public concepts and validation behavior are fixed by this target.

### Validation

- `schemaVersion` must be exactly `2`.
- Resource-group IDs, profile IDs, profile versions, logical services, and profile configuration hashes are stable non-empty identities.
- Every protection-enabled resource group references at least one existing profile.
- Every profile is exhaustive for the enabled CDM/CIM capabilities and every configurable non-terminal phase.
- Every decision belongs to the core-defined safety envelope for its module and phase.
- Terminal phases are core-owned `none` decisions and cannot be configured.
- Unknown fields, duplicate identities, invalid timing, module/action mismatch, unsupported retract parameters, missing capability, and incomplete matrices fail hostd startup.
- Legacy `disconnectAction` configuration fails with explicit migration guidance.

## Profile binding

- Lease acquisition for a protection-enabled resource group requires `protectionPolicyProfileId`.
- The selected profile must be allowlisted for the resource group.
- Hostd binds profile ID, version, and configuration hash to host epoch, owner, operation, lease, and journal.
- Rebind during suspect grace preserves the original profile and deadlines.
- Application code cannot submit raw protection actions or timing values and cannot switch profiles after acquisition.
- Hostd exposes the frozen customer-access deadline so application UI can coordinate without owning or extending it.

## Protection phases

The implementation may use finer private substates, but safe journal and client contracts expose stable module-qualified phases and preserve unknown future strings.

### CDM phases

- `idle`
- `dispenseInFlight`
- `cashHeld`
- `presentInFlight`
- `customerAccessible`
- `retractInFlight`
- terminal `notMoved`
- terminal `taken`
- terminal `retracted`
- terminal `custodyUnknown`

### CIM phases

- `idle`
- `cashInActive`
- `accepting`
- `escrowHeld`
- `commitInFlight`
- `rollbackInFlight`
- `customerAccessible`
- `retractInFlight`
- terminal `notAccepted`
- terminal `taken`
- terminal `retracted`
- terminal `committed`
- terminal `custodyUnknown`

An in-flight command is allowed to settle within the frozen command-settlement timeout. A known completion advances phase; an unknown outcome or conflicting observation enters intervention and never causes automatic redispatch.

## Core safety envelope

| Module and phase | Allowed policy decision |
| --- | --- |
| CDM `cashHeld` | `cdmRetract` or `intervention` |
| CDM `customerAccessible` | `waitUntilDeadlineThenCdmRetract` or `waitUntilDeadlineThenIntervention` |
| CIM `cashInActive`, `accepting`, `escrowHeld` | `cimRollbackThenAwaitTake` or `intervention` |
| CIM `customerAccessible` | `waitUntilDeadlineThenCimRetract` or `waitUntilDeadlineThenIntervention` |
| Any cash command in flight | core `awaitSettlementThenReevaluate` |
| Known terminal phase | core `none` |
| Unknown, insufficient, or conflicting evidence | core `intervention` |

`intervention` is an allowed explicit conservative choice for configurable non-terminal phases. Omitted matrix entries are startup errors and do not imply intervention.

## Customer-access deadline

- Hostd establishes and durably records the deadline when native outcome or device observation proves cash became customer-accessible.
- The timeout comes from the operation-bound Protection Policy Profile.
- Application disconnect, reconnect, owner rebind, and hostd restart never create a new full take window.
- A take observation before deadline records terminal `taken`.
- At deadline, hostd observes the device before dispatching a configured retract.
- Successful rollback or present transitions to `customerAccessible`; it does not complete protection.
- Successful retract must be corroborated before recording terminal `retracted`.

## Protection Journal v2

The append-only journal records safe facts only:

- host epoch, resource group, logical service, module, operation, owner, and fencing token;
- protection profile ID, version, and configuration hash;
- cash-affecting command intent before dispatch;
- native completion code and execution certainty without unrestricted provider text;
- phase transitions and their evidence source;
- suspect loss, rebind, irreversible protection activation, and deadline;
- policy decision, unique protection action ID, durable action intent, outcome, and safe detail;
- take, retract, terminal-custody, conflict, restart, and intervention observations.

Raw note data, customer values, PIN material, track data, unrestricted payloads, and unrestricted native errors are prohibited.

Acknowledgement is accepted only after terminal custody or an append-only authorized Intervention Resolution. Application recovery imports journal facts into canonical operation evidence before acknowledgement.

## Hostd restart contract

- Unresolved resource groups remain fenced and unavailable to new transaction authority.
- Passive phases such as `customerAccessible` resume observation and the remaining persisted deadline.
- A new retract intent may be created only after fresh observation proves cash is still customer-accessible and no earlier retract intent exists.
- A rollback, retract, present, dispense, or commit intent with unknown outcome is never redispatched.
- Lost or conflicting provider state, unavailable logical service, journal inconsistency, and uncertain command outcome enter intervention.
- Terminal records remain terminal and await application evidence import and acknowledgement.
- Restart continuation never resumes Flow, host posting, business validation, or operation finalization.

## Cross-repository implementation

### `tripley-native`

- Replace protection configuration with strict schema v2 types and validation.
- Add the host-owned CDM/CIM phase tracker and core safety-envelope validator.
- Journal owner cash-affecting intents/outcomes before advancing phase.
- Bind profile identity to command leases and reconnect proof.
- Replace single-action activation with the bounded protection state machine.
- Add customer-take observation, deadline handling, corroborated retract, and terminal/intervention outcomes.
- Resume only proven-safe passive work after restart.
- Expose safe phase, deadline, policy identity, custody outcome, and journal records over xRPC.

### `tripley-kit`

- Update xRPC-generated/public lease and protection types for profile binding and phase-aware status.
- Preserve unknown future phase strings in client contracts.
- Update `@tripley-kit/xfs-client` tests for required profile IDs, stale owner rejection, and safe journal projections.
- Replace the current CIM smoke completion assertion with terminal-custody assertions.
- Add real simulator CDM disconnect smokes for pre-present retract and customer-access timeout/retract.

### `tripley-acctron`

- Update XFS device-service lease adapters to select configured profile IDs without exposing raw action/timing controls.
- Update hostd example and real-smoke configuration to schema v2.
- Import safe protection phase, deadline, and terminal outcome contracts without treating them as Flow state.
- Keep Recovery Startup Barrier integration as the next application-recovery target; this target exposes the contracts it will consume.

## Tests

### Unit and contract tests

- Legacy schema and incomplete matrices fail startup with actionable errors.
- Invalid module/phase/action combinations fail validation.
- Standard and accessibility profiles bind immutably to leases.
- Journal write failure prevents native dispatch of every Cash-Affecting Command.
- Read-only commands remain available when the cash journal is unavailable.
- CDM and CIM command outcomes advance only their legal phase transitions.
- Application metadata cannot mutate phase or extend deadlines.
- Same-owner rebind preserves profile and remaining deadline.
- Stale owners and stale fencing tokens cannot dispatch or acknowledge.
- Successful CIM rollback transitions to customer-accessible rather than completed.
- Take before deadline records terminal `taken` without retract.
- Deadline expiry plus corroborated cash presence dispatches one retract intent.
- Unknown command execution and conflicting observations enter intervention.
- Restart resumes passive waiting but never redispatches an unknown intent.
- Acknowledgement rejects non-terminal custody.
- Journal and trace summaries contain no sensitive cash-item or customer data.

### Real simulator smokes

- CIM cash is accepted, owner disconnect activates rollback, returned cash is taken through control automation, and journal reaches terminal `taken`.
- CDM cash is dispensed but not presented, owner disconnect retracts it, and journal reaches terminal `retracted`.
- CDM cash is presented, owner disconnect preserves the remaining customer-access deadline, no take is injected, one retract occurs, and journal reaches terminal `retracted`.
- Each smoke restores simulator cash-unit fixtures and leaves the resource group idle only after evidence assertions and acknowledgement.

## Non-goals

- IDC eject/retain phase modeling.
- Arbitrary or dynamically downloaded host plugins.
- Application Flow restart or transaction replay.
- Host financial completion, reversal, or advice.
- Hostd-initiated dispense, present, CIM physical commit, or new cash acceptance.
- Automatic retry of physical-media command intents with unknown outcomes.
- Legacy protection configuration compatibility.

## Implementation order

1. Introduce schema v2, profile binding, phase and journal contracts with validation tests.
2. Journal normal owner Cash-Affecting Commands before native dispatch and derive phase from safe outcomes.
3. Implement the core safety envelope and bounded disconnect state machine.
4. Add customer-access deadline, take observation, retract corroboration, and terminal outcomes.
5. Add restart continuation for passive phases and intervention for uncertain side effects.
6. Update xRPC and `xfs-client` public contracts.
7. Update application adapters and schema-v2 configurations.
8. Run unit, workspace, package, isolated hostd, and real CIM/CDM simulator smokes.

## Done when

- One protection-enabled CDM/CIM resource group safely selects phase-specific behavior from an operation-bound allowlisted profile.
- Every Cash-Affecting Command has durable intent before dispatch and journal failure is fail-closed.
- Owner disconnect protection runs until terminal custody or intervention.
- Application reconnect and hostd restart cannot reset deadlines or repeat execution-unknown physical commands.
- Safe phase and journal contracts cross native, xRPC, xfs-client, and application adapter boundaries without exposing raw XFS clients or sensitive values.
- Real simulator CIM rollback/take and CDM retract scenarios pass with canonical logical service names.
- Existing native workspace, package, application test, and build suites pass.
