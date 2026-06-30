# 20. Kiosk Flow Best Practices

## Transaction flow structure

Typical transaction:

```text
precheck
select action
user input
validate local
validate host
execute host request
execute device action
confirm result
receipt / audit
cleanup
return main menu
```

## Global user input timeout

Do not handle timeout in every user input node. Define project/flow-level policy:

```ts
policies: {
  userInputTimeout: {
    timeoutMs: 30_000,
    onTimeout: { type: 'next', nodeId: 'returnToMainMenu' }
  }
}
```

Override only when a node needs special behavior.

## Global device interrupts

Use flow interrupt policy for card removed, headphone removed, cash unit fatal, printer fatal, SIU events, maintenance switch, etc.

```ts
interrupts: [
  { id: 'card.removed', priority: 100, eventTopic: 'device.card.removed', action: { type: 'cancelFlow', reasonCode: 'CARD.REMOVED' } },
  { id: 'blind.headphone.removed', priority: 90, eventTopic: 'device.siu.headphone.removed', appliesTo: 'accessibility.blindMode.enabled', action: { type: 'cancelFlow', reasonCode: 'HEADPHONE.REMOVED' } }
]
```

Interrupts execute `flow.finally`.

## Cleanup

Every transaction flow should use `finally` to:

- stop TTS.
- cancel active device operation.
- release device locks.
- cancel always-on-top when used.
- clear transaction scoped store.
- update transaction repository status.
- write audit failure/finish record.

## Validation

Local input validation stays in the userInput node. Business/host validation uses separate action node and may reenter input node with error context.

## Idempotency

Use idempotency keys for:

- flow start.
- command execution.
- host request.
- cash dispense.
- print.
- payment.

For side-effect nodes, record operation in OperationLedger.

## Logging and audit

Diagnostic logs and audit journal are separate. Logs use JSONL with safe summaries; EJ/audit is append-only business record.

## Legacy coexistence

Use Flow to manage screen takeover and release. Do not hide this in Window Manager high-level session API.
