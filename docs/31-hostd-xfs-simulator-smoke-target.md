# Next Target: Hostd XFS Simulator Smoke

## Decision

The next target after the `@tripley-kit/xfs-client` multi-module facade is a hostd-backed XFS simulator smoke test, not the framework XFS Device Service.

## Why this is next

The TypeScript facade blocker is resolved, but the remaining unknowns are environmental and contractual:

- Which XFS logical service names are actually configured on the current simulator.
- Whether `tripley-native-hostd` can expose `runtime`, `xfs`, and `xfs-control` together on this PC.
- Whether `@tripley-kit/xfs-client` can resolve the required module instances through hostd.
- Whether `@tripley-kit/xfs-control-client` can drive the simulator state needed for automated tests.
- Whether IDC, PIN, and BCR operations have the expected command, completion, event, and cancellation behavior.

Starting `xfs-device-service` before proving those contracts would risk building framework adapters against guessed service names and guessed simulator behavior.

## Target outcome

Create a small smoke target that proves a browser-compatible or script-compatible test can:

- Connect to `tripley-native-hostd` over WebSocket.
- Create `@tripley-kit/native` if native runtime capability is needed for the smoke.
- Create `@tripley-kit/xfs-client` with `requiredModules`.
- Create `@tripley-kit/xfs-control-client`.
- List or confirm simulator logical services.
- Open IDC, PIN, and BCR logical services.
- Drive one simulator action through xfs-control.
- Observe the corresponding runtime XFS operation or event through xfs-client.
- Dispose all clients cleanly.

## Recommended scope

Use a script or test package in `E:\code\front-end\tripley-kit` first. Keep it close to the Tripley Kit clients because the purpose is to prove the provider/client contract, not the framework abstraction.

After the smoke passes, move the proven assumptions into this framework as `xfs-device-service` configuration defaults and integration fixtures.

## Suggested command shape

Development hostd command:

```powershell
cargo run -p tripley-native-hostd --target i686-pc-windows-msvc --no-default-features --features transport-websocket,service-xfs,service-xfs-control -- --addr 127.0.0.1:39010 --services runtime,xfs,xfs-control --xfs-dll-directory "C:\Program Files\Tripley.XFS\sp32" --xfs-control-simulator-ws-url ws://127.0.0.1:39001
```

The smoke should accept these environment variables:

- `TRIPLEY_NATIVE_HOSTD_URL`, default `ws://127.0.0.1:39010`
- `TRIPLEY_NATIVE_HOSTD_AUTH_TOKEN`, optional
- `TRIPLEY_XFS_IDC_LOGICAL_NAME`, default to discovered value or `IDC30`
- `TRIPLEY_XFS_PIN_LOGICAL_NAME`, default to discovered value or `PIN30`
- `TRIPLEY_XFS_BCR_LOGICAL_NAME`, default to discovered value or `BCR30`

## Acceptance criteria

- The smoke resolves `manager`, `idc`, `pin`, and `bcr` through `requiredModules`.
- The smoke confirms the canonical logical service names for the installed simulator.
- The smoke can open and close the IDC logical service.
- The smoke can use xfs-control to insert or remove a simulator card.
- The smoke can observe IDC runtime state or events through xfs-client.
- The smoke can confirm PIN and BCR services are resolvable, even if full PIN/BCR command automation is deferred.
- Failures identify whether the problem is hostd startup, module resolution, logical service configuration, simulator control, or runtime XFS behavior.

## What this unlocks

Once this target passes, the next implementation target should be `packages/xfs-device-service` in the framework, starting with IDC, PIN, and BCR ports plus `pinpad.data`, `pinpad.pin`, and `barcodeReader.qr` input source adapters.
