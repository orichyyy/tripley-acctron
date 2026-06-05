# @tripley-acctron/runtime-core

Runtime composition entrypoint for kiosk applications.

`createKioskApp` wires service registry, lifecycle registry, plugins, and typed event/command/query
buses.

`registerTransactionLifecycle` installs transaction commands and queries:

- `transaction.start`: runs a flow through a `FlowRunner` and returns lifecycle status.
- `transaction.cancel`: aborts the active flow and waits for cleanup.
- `transaction.reset`: cancels any active flow, clears transaction data, closes dialogs, and returns
  to idle.
- `transaction.status`: returns the current lifecycle snapshot.

`registerOperationalControl` installs service operation commands and queries:

- `service.applyHostCommand`: applies canonical host suspend, resume, and maintenance commands.
- `service.resume`, `service.enterMaintenance`, and `service.exitMaintenance`: direct runtime
  controls.
- `service.status`: returns online, suspending, suspended, or maintenance state.

Use `OperationalControlController.beforeTransactionStart` as the transaction start guard and call
`afterTransactionSettled` from transaction completion, failure, and cancellation hooks.

Update this document when app startup, shutdown, plugin composition, transaction lifecycle, or role
behavior changes.
