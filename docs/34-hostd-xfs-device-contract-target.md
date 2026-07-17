# Hostd-backed XFS Device Contract Target

## Decision

Validate `xfs-device-service` against an already-running Tripley Native Host and XFS simulator. The suite is opt-in and does not own hostd or simulator process lifecycle.

## Boundary

- Production code uses `@tripley-kit/xfs-client` only through `xfs-device-service`.
- Simulator automation lives in the private `xfs-test-harness` package.
- `@tripley-kit/xfs-control-client` is absent from production package dependencies.
- Logical service names are discovered from the XFS Control Plane or supplied by environment variables.
- Default workspace tests do not require hostd or the simulator.

## Command

```powershell
pnpm test:xfs-hostd
```

The default endpoint is `ws://127.0.0.1:39010`. Override it with `TRIPLEY_NATIVE_HOSTD_URL`. If connection fails, the suite tells the operator to start hostd. If hostd is reachable but omitted the control capability, the suite explicitly requires `--services runtime,xfs,xfs-control`.

The provider currently loaded from `K:\ATMdoc\dll` completes one full contract cycle but returns `-15` when a second independent XFS app cycle is started in the same hostd process. Restart hostd before rerunning this suite. This is an installed provider lifecycle limitation; the framework does not call global manager cleanup.

## Acceptance

- Canonical IDC, PIN, and BCR logical services are discovered and registered.
- IDC card insertion is driven by the control plane and read through the framework device port.
- PIN data is entered through simulator keys and returned through `pinpad.data`.
- Secure PIN entry performs PIN collection followed by PIN-block generation and exposes only a safe encrypted result.
- The private test setup resets IDC no-media state and provisions a simulator-only PIN key through short-lived XFS sessions; production device ports do not expose raw key import.
- BCR reads are completed through the control plane and returned through `barcodeReader.qr`.
- Cancelling the BCR input session clears the active simulator command.
- Cancellation sends manager cancel-all for the session and follows with the module reset needed to terminate typed pending operations on the installed provider.
- Health checks succeed for all configured logical services.
- Disposal closes service-owned sessions and the WebSocket client but does not call global manager cleanup because hostd lifecycle is externally owned.
