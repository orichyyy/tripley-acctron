# Next Target: Framework XFS Device Service

## Decision

After the Tripley Kit XFS facade and hostd simulator smoke entrypoint, the next implementation target is a framework-owned XFS Device Service package.

## Scope

Create a production framework package that wraps `@tripley-kit/xfs-client` behind the existing Device Abstraction Layer.

The first slice should cover:

- IDC card reader device port.
- PIN pad data input device port.
- PIN pad secure PIN device port.
- BCR barcode reader device port.
- Device registration through `DeviceRegistry`.
- Input source adapter registration through `InputSourceRegistry`.
- Health checks for configured logical services.
- XFS connection and session lifecycle.
- Cancellation semantics for active input sessions.
- Safe summaries and secure input redaction.

## Explicit non-goals

- Do not implement CDM dispense in this slice.
- Do not import `@tripley-kit/xfs-control-client`.
- Do not modify Flow Engine or `UserInputNodeExecutor`.
- Do not hard-code simulator logical service names such as `IDC30`, `PIN30`, or `BCR30`.
- Do not expose raw XFS clients to application code.

## Required package boundary

The new package should be the only production framework package that imports `@tripley-kit/xfs-client`.

Application and framework core code should continue to depend on:

- `DeviceRegistry`
- `InputSourceRegistry`
- `DeviceLockManager`
- framework device ports
- health checks
- event topics

## Proposed public API

```ts
export interface XfsDeviceServiceConfig {
  readonly url: string;
  readonly authToken?: string;
  readonly appId?: string;
  readonly timeoutMs?: number;
  readonly startup?: {
    readonly enabled?: boolean;
    readonly lowVersion?: number;
    readonly highVersion?: number;
  };
  readonly logicalServices: readonly XfsLogicalServiceConfig[];
}

export interface XfsLogicalServiceConfig {
  readonly deviceId: string;
  readonly logicalName: string;
  readonly module: "idc" | "pin" | "bcr";
  readonly capabilities: readonly string[];
  readonly dataClassification?: "public" | "internal" | "sensitive" | "restricted" | "secret";
}

export interface XfsDeviceService {
  connect(): Promise<void>;
  registerDevices(devices: DeviceRegistry): void;
  registerInputSources(inputSources: InputSourceRegistry): void;
  healthChecks(): readonly HealthCheck[];
  dispose(): Promise<void>;
}
```

## Implementation shape

The service should:

- Create `createWebSocketXfsClient` with `requiredModules` inferred from configured logical services plus `manager`.
- Start XFS manager when configured.
- Open one runtime session per configured logical service.
- Register one framework device per configured logical service.
- Keep session ids internal to the service.
- Use `manager.cancelAsyncRequest` for cancellation.
- Use `manager.close` during disposal.
- Convert XFS results into framework-safe result objects.
- Preserve raw completion codes only in safe diagnostic metadata.

## Input source adapters

Register these through `InputSourceRegistry`:

- `pinpad.data`
- `pinpad.pin`
- `barcodeReader.qr`

The adapters must:

- Find devices through `DeviceRegistry`.
- Start operations through device ports.
- Return `InputSourceSession`.
- Implement `cancel()`.
- Use safe summaries.
- For secure PIN, return only encrypted/tokenized result metadata and never raw PIN digits.

## Testing target

Prefer fake XFS clients for unit/integration tests in this repo. Do not require the real simulator in default tests.

Tests should prove:

- Device registration is driven by config and does not use hard-coded logical service names.
- `requiredModules` is inferred correctly from configured modules.
- IDC, PIN, and BCR health checks report available status.
- `pinpad.data` adapter starts through the registered pinpad device.
- `pinpad.pin` adapter returns a secure safe summary only.
- `barcodeReader.qr` adapter returns plain QR result summary.
- Calling `InputSourceSession.cancel()` calls the XFS cancellation path.
- Disposal closes sessions and disposes the XFS client.
- A project can register another input source adapter without modifying this service.

## Open grilling point

If the hostd smoke has not passed on the target machine yet, keep all logical service names configuration-only and do not encode simulator defaults in this package. Defaults may live only in examples or local `.env` files.
