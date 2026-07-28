# Target 65: Correlated Input and Subflow Foundation

## Status

Implemented and validated.

## Objective

Complete the reusable Flow Engine and input-source capabilities required for a production kiosk Customer Admission Flow, Card Session Flow, and version-bound transaction subflows. The implementation remains bank-neutral and is demonstrated in kiosk-example before BSP consumes published packages.

## Packages

- `@tripley-kit/web-container-device-core`
- `@tripley-kit/web-container-flow-engine`
- `@tripley-kit/web-container-xfs-device-service`
- `apps/kiosk-example`

## Correlated programmatic input

Device core provides a programmatic `InputSourceAdapter` and broker using an interaction identity containing:

- channel ID;
- flow instance ID;
- node ID;
- unique interaction ID for every node entry or reentry.

An input source declares its allowed semantic intent IDs. A submission must match the active interaction identity and allowlist. Stale, duplicate, unauthorized, cancelled, and no-longer-pending submissions fail without resolving, rejecting, cancelling, or otherwise mutating the current input session.

The broker supports independent channels without allowing two active interactions to own one channel. Completed/cancelled interaction tombstones are bounded. Submitted payload remains opaque to the broker and is validated by the UserInput node.

The reference example binds one CommandRegistry command to broker submission; Flow Engine does not depend on Command System or React.

## Safe input progress

`InputSourceSession` may expose replayable progress:

```ts
interface InputSourceProgress {
  readonly kind: string;
  readonly activity: boolean;
  readonly safeSummary: Record<string, unknown>;
}
```

Progress is safe projection material, not raw input. Adapters must never expose a PIN digit, key value, clear credential, PIN block, card Track, barcode payload, or other protected source value through progress.

UserInput can map progress to UI feedback/projection. Progress marked as customer activity resets `idleTimeoutMs`; it never resets the absolute node `timeoutMs`. Device/provider command deadlines remain adapter-owned infrastructure deadlines.

Progress subscription replays the latest event so startup feedback cannot be lost between command creation and Flow subscription. Node exit, timeout, interrupt, cancellation, and engine disposal unsubscribe progress and cancel all active sessions.

## Card input adapter

Device core provides a generic `cardReader.card` adapter factory over a card-reader input port. XFS device service's IDC module registers the adapter beside its DeviceRegistry port.

The adapter:

- starts card acquisition with the Flow operation identity and signal;
- returns protected card material only as the input result;
- emits only a safe summary;
- cancels the active IDC read command on session cancellation;
- does not eject, retain, or decide customer-session custody policy.

Physical-custody arbitration after concurrent entry signals remains application policy.

## XFS PIN progress bridge

XFS device service converts PIN key events into safe, device-independent progress containing only:

- digit count;
- `started`, `changed`, `cleared`, or `terminated` state;
- activity indication.

The adapter does not expose the XFS digit, function-key mask, raw event, PIN block, or customer data. Custom PIN device plugins can implement the same core progress contract.

## Version-bound subflow contract

Flow Engine supports synchronous subflow bindings with:

- explicit flow ID and version;
- dynamic input resolution from parent execution context;
- child input-schema validation;
- child output-schema validation before parent acceptance;
- optional typed output acceptance/binding;
- parent cancellation propagation;
- failed/cancelled child preservation;
- isolated child flow-local state while retaining registered engine ports, adapters, hooks, policies, and safe projection.

Applications do not manually call `engine.start()` from an action node to emulate a subflow. Detached work remains an explicit effect/outbox concern rather than an unowned asynchronous transaction subflow.

## Kiosk example

Kiosk-example:

- removes its local `UiInputBroker`;
- uses the core correlated programmatic adapter;
- demonstrates a bank-neutral admission flow waiting for UI and card sources;
- demonstrates a card-session parent invoking a version-bound transaction subflow;
- renders safe input progress;
- keeps React outside transaction/device lifecycle;
- contains no BSP message, intent, account, receipt, or bank policy.

## Tests

Tests prove:

- stale interaction ID cannot satisfy a new attempt of the same node;
- duplicate and unauthorized intent submissions do not alter the active session;
- cancellation creates bounded completed-interaction evidence and releases the channel;
- independent channels can operate concurrently;
- latest safe progress is replayed to a late subscriber;
- PIN progress contains digit count only and resets idle timeout;
- hard timeout is not extended by progress;
- timeout, interrupt, node exit, parent cancellation, and engine disposal cancel sessions and subscriptions;
- IDC read cancellation reaches the XFS port;
- card adapter logs/traces only safe summary;
- dynamic subflow input and validated output cross the parent/child boundary;
- invalid child output fails before parent acceptance;
- child cancellation propagates safely to parent card-session cleanup;
- a custom card or PIN plugin works without modifying Flow Engine.

## Validation and release

Run focused tests, affected package typechecks/builds, and kiosk-example build. Commit the coherent target, publish every changed library to npmjs using official registry, then update BSP only to released package versions.
