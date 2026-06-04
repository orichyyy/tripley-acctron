# @tripley-acctron/react-ui

React adapter for framework `UiPort` contracts.

## Runtime Store

`UiRuntimeStore` holds the current screen, screen state, dialogs, and pending action waiters.
`ReactUiAdapter` writes framework `show`, `patch`, `openDialog`, and `closeDialog` calls into that
store, while React components emit actions with `store.emitAction`.

`useUiRuntime(store)` subscribes React components with `useSyncExternalStore`, so browser screens can
render framework state without depending on flow-engine internals.

## Usage

`apps/demo-kiosk` demonstrates the intended pattern:

- composition creates one `UiRuntimeStore` and one `ReactUiAdapter`;
- flow steps call `UiPort` methods only;
- React screens inspect the store snapshot and emit typed UI actions;
- business routing remains in flow steps and recipes.
