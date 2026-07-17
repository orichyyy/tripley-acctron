# Tripley Kit Native and XFS Integration Plan

## Goal

Make this framework usable as a kiosk application development platform by integrating:

- `@tripley-kit/native` for Native SDK capabilities required by the framework.
- `@tripley-kit/xfs-client` for runtime CEN/XFS device operations.
- `@tripley-kit/xrpc-runtime` WebSocket transport through `tripley-native-hostd`.
- `@tripley-kit/xfs-control-client` for simulator-driven automated tests only.

The integration must preserve the framework rule that application code talks to Flow, Command, UI, Device, and InputSource abstractions, not raw native or XFS clients.

## Non-negotiable boundaries

- Core Flow, Command, Condition, UI, and kiosk application packages must not import `@tripley-kit/xfs-client`.
- `UserInputNodeExecutor` must keep using `InputSourceRegistry` lookup only.
- `@tripley-kit/xfs-control-client` must be dev/test-only and must not appear in production presets.
- Native window/display/SQLite/TTS/secure storage continue through the Native SDK adapter path.
- CEN/XFS device operations continue through framework device services and input source adapters, not through `docs/14-native-sdk-api-requirements.md`.

## Current integration facts

- `@tripley-kit/native` exposes `createWebSocketTripleyNative`, `createTauriTripleyNative`, `createElectronTripleyNative`, and container adapters.
- `tripley-native-hostd` can expose WebSocket services with `--services runtime,fs,archive,tcp,websocket,sqlite,system,xfs,xfs-control`.
- `@tripley-kit/xfs-client` exposes `createWebSocketXfsClient`, but its current top-level client facade only resolves `manager` and `idc`.
- Generated `@tripley-kit/xfs-client` code includes module clients for BCR, CDM, CIM, IDC, PIN, PTR, SIU, TTU, and VDM.
- `@tripley-kit/xfs-control-client` exposes simulator control clients for runtime, CDM, CIM, IDC, PIN, PTR, SIU, TTU, and BCR.

## Architecture

```text
Kiosk application
  -> Command / Flow / UI / Condition
  -> DeviceRegistry + InputSourceRegistry + HealthCheckCenter
  -> @tripley/web-container-xfs-device-service
  -> @tripley-kit/xfs-client
  -> @tripley-kit/xrpc-runtime WebSocketXRpcTransport
  -> tripley-native-hostd
  -> Tripley.XFS simulator or real XFS manager/SPs

Automated simulator tests
  -> Test harness
  -> @tripley/web-container-xfs-test-harness
  -> @tripley-kit/xfs-control-client
  -> tripley-native-hostd xfs-control service
  -> XFS simulator control websocket
```

## Proposed packages

### `packages/native-tripley-kit`

Purpose: provide production-ready factories that adapt `@tripley-kit/native` into the existing `NativePort`.

Responsibilities:

- Create `TripleyNative` via WebSocket, Tauri, or Electron.
- Wrap it with `TripleyNativeAdapter`.
- Install required container adapters where the runtime supports them.
- Fail fast for required native capabilities.
- Own connection disposal and reconnect policy wiring.

Public API sketch:

```ts
export interface TripleyKitNativeConnectionOptions {
  readonly url?: string;
  readonly authToken?: string;
  readonly mode: "websocket" | "tauri" | "electron";
  readonly requiredServices?: readonly NativeServiceName[];
}

export function createTripleyKitNativePort(
  options: TripleyKitNativeConnectionOptions,
): Promise<NativePort>;
```

### `packages/xfs-device-service`

Purpose: translate `@tripley-kit/xfs-client` into framework device ports, input source adapters, device events, locks, and health checks.

Responsibilities:

- Create and own the `TripleyXfsClient`.
- Connect to hostd over WebSocket.
- Start up and clean up XFS manager lifecycle.
- Map configured logical service names to framework device ids.
- Open, register, lock, unlock, close, and heartbeat XFS sessions.
- Register framework devices in `DeviceRegistry`.
- Register framework input source adapters in `InputSourceRegistry`.
- Register health checks and event mapping.
- Convert XFS completion codes into framework results/errors.
- Redact secure input and emit safe summaries only.

Runtime dependencies:

- `@tripley-kit/xfs-client`
- `@tripley-kit/xrpc-runtime`
- `@tripley/web-container-device-core`
- `@tripley/web-container-plugin-system`
- `@tripley/web-container-errors`
- `@tripley/web-container-logging`

No dependency on React, React Router, or simulator control.

### `packages/xfs-test-harness`

Purpose: automate simulator state for integration and browser tests.

Responsibilities:

- Create `TripleyXfsControlClient`.
- Configure logical services.
- Insert/take IDC cards.
- Complete BCR reads.
- Press PIN/TTU keys.
- Configure CDM/CIM cash units.
- Trigger and drain simulator events.
- Provide deterministic setup/teardown helpers.

Runtime scope:

- Test-only dependency.
- Never imported by kiosk base or production application bundles.

## Required upstream change in `@tripley-kit/xfs-client`

Before wrapping all devices, the package needs a stable public facade for every generated module client. The framework should not import `libs/xfs-client/src/generated/client`.

Minimum acceptable facade:

```ts
export interface TripleyXfsClient {
  readonly manager: XfsManagerServiceClient;
  readonly bcr: XfsBcrServiceClient;
  readonly cdm: XfsCdmServiceClient;
  readonly cim: XfsCimServiceClient;
  readonly idc: XfsIdcServiceClient;
  readonly pin: XfsPinServiceClient;
  readonly ptr: XfsPtrServiceClient;
  readonly siu: XfsSiuServiceClient;
  readonly ttu: XfsTtuServiceClient;
  readonly vdm: XfsVdmServiceClient;
  readonly clientState: XRpcConnectionState;
  connect(): Promise<void>;
  dispose(): Promise<void>;
}
```

If the host can expose only a subset of XFS modules, the facade should support optional required modules:

```ts
createWebSocketXfsClient({
  url,
  requiredModules: ["manager", "idc", "pin", "bcr"],
});
```

## Device service configuration

```ts
export interface XfsDeviceServiceConfig {
  readonly url: string;
  readonly authToken?: string;
  readonly startup?: {
    readonly lowVersion?: number;
    readonly highVersion?: number;
    readonly timeoutMs?: number;
  };
  readonly logicalServices: readonly XfsLogicalServiceConfig[];
  readonly sessionPolicy?: {
    readonly openOnBoot?: boolean;
    readonly closeOnDispose?: boolean;
    readonly heartbeatMs?: number;
    readonly defaultTimeoutMs?: number;
  };
}

export interface XfsLogicalServiceConfig {
  readonly deviceId: string;
  readonly logicalName: string;
  readonly module: "idc" | "pin" | "bcr" | "cdm" | "cim" | "ptr" | "siu" | "ttu";
  readonly capabilities: readonly string[];
  readonly dataClassification?: "public" | "internal" | "sensitive" | "restricted" | "secret";
}
```

Example project config:

```ts
const xfsDevices = defineXfsDeviceService({
  url: "ws://127.0.0.1:39010",
  logicalServices: [
    { deviceId: "cardReader", logicalName: "IDC30", module: "idc", capabilities: ["card.read", "card.eject"] },
    { deviceId: "pinpad", logicalName: "PIN30", module: "pin", capabilities: ["pin.getData", "pin.getPin"], dataClassification: "secret" },
    { deviceId: "barcodeReader", logicalName: "BCR30", module: "bcr", capabilities: ["barcode.qr"], dataClassification: "sensitive" },
    { deviceId: "cashDispenser", logicalName: "CDM30", module: "cdm", capabilities: ["cash.dispense"] },
  ],
});
```

## Device ports to implement first

### IDC card reader

Framework port:

```ts
export interface CardReaderPort {
  readCard(options: CardReadOptions, context?: DeviceOperationContext): Promise<CardReadResult>;
  ejectCard(options?: CardEjectOptions, context?: DeviceOperationContext): Promise<void>;
  retainCard(options?: CardRetainOptions, context?: DeviceOperationContext): Promise<void>;
  getStatus(): Promise<DeviceStatusSummary>;
  cancel(operationId?: string, reason?: string): Promise<void>;
}
```

Backed by:

- `manager.open`
- `manager.lock`
- `idc.readRawData`
- `idc.ejectCard`
- `idc.retainCard`
- `manager.cancelAsyncRequest`
- `idc.subscribeEvent`
- `idc.subscribeExecuteComplete`

### PIN pad

Framework ports:

```ts
export interface XfsPinpadDataPort {
  getData(options: PinpadGetDataOptions, context?: DeviceOperationContext): Promise<UserInputSourceResult>;
  cancel(operationId?: string, reason?: string): Promise<void>;
}

export interface XfsPinpadPinPort {
  getPin(options: PinpadGetPinOptions, context?: DeviceOperationContext): Promise<SecurePinInputResult>;
  cancel(operationId?: string, reason?: string): Promise<void>;
}
```

Backed by:

- `pin.getData`
- `pin.getPin`
- `pin.getPinblock`
- `manager.cancelAsyncRequest`
- `pin.subscribeEvent`
- `pin.subscribeExecuteComplete`

Security rule:

- `getPin` may return encrypted PIN block, KSN, key id, and safe summary.
- It must never return or log clear PIN digits.

### BCR barcode reader

Framework port:

```ts
export interface XfsBarcodeReaderPort {
  startScan(options: BarcodeScanOptions, context?: DeviceOperationContext): Promise<InputSourceSession<UserInputSourceResult>>;
  stopScan(operationId?: string, reason?: string): Promise<void>;
  getStatus(): Promise<DeviceStatusSummary>;
}
```

Backed by:

- `bcr.read`
- `bcr.reset`
- `manager.cancelAsyncRequest`
- `bcr.subscribeEvent`
- `bcr.subscribeExecuteComplete`

### CDM cash dispenser

Framework port:

```ts
export interface CashDispenserPort {
  getStatus(): Promise<DeviceStatusSummary>;
  getCashUnitInfo(): Promise<CashUnitInfoSummary>;
  dispense(options: DispenseOptions, context?: DeviceOperationContext): Promise<DispenseResult>;
  present(options?: PresentOptions, context?: DeviceOperationContext): Promise<void>;
  retract(options?: RetractOptions, context?: DeviceOperationContext): Promise<RetractResult>;
  cancel(operationId?: string, reason?: string): Promise<void>;
}
```

Backed by:

- `cdm.getStatus`
- `cdm.getCashUnitInfo`
- `cdm.denominate`
- `cdm.dispense`
- `cdm.present`
- `cdm.retract`
- `manager.cancelAsyncRequest`

## Input source adapters

Register these as adapters, not executor special cases:

- `pinpad.data` -> `XfsPinpadDataPort.getData`
- `pinpad.pin` -> `XfsPinpadPinPort.getPin`
- `barcodeReader.qr` -> `XfsBarcodeReaderPort.startScan`
- `cardReader.track` -> `CardReaderPort.readCard`

The adapter must:

- Generate a framework operation id.
- Pass `AbortSignal` where supported.
- Cancel the XFS request on `InputSourceSession.cancel()`.
- Return safe summaries.
- Mark secure input as `secret`.
- Allow project-specific adapters to coexist.

## Event mapping

XFS event subscriptions should be translated to framework event topics:

- IDC media/card events -> `device.card.inserted`, `device.card.removed`, `device.status.changed`
- PIN status/events -> `device.status.changed`, `device.pin.keyPressed.safe`
- BCR position/status -> `device.status.changed`, `device.barcodeReader.ready`
- CDM cash unit/status -> `device.cashUnit.empty`, `device.status.changed`
- SIU sensors -> `device.siu.headphone.inserted`, `device.siu.headphone.removed`, `device.status.changed`

Raw XFS event payloads may be attached only as redacted metadata for diagnostics.

## Host process plan

Development command:

```powershell
cargo run -p tripley-native-hostd --target i686-pc-windows-msvc --no-default-features --features transport-websocket,service-xfs,service-xfs-control -- --addr 127.0.0.1:39010 --services runtime,xfs,xfs-control --xfs-dll-directory "C:\Program Files\Tripley.XFS\sp32" --xfs-control-simulator-ws-url ws://127.0.0.1:39001
```

Browser smoke tests use:

- `createWebSocketTripleyNative({ url: "ws://127.0.0.1:39010" })`
- `createWebSocketXfsClient({ url: "ws://127.0.0.1:39010" })`

Automation tests also use:

- `createWebSocketXfsControlClient({ url: "ws://127.0.0.1:39010" })`

Production kiosk presets should not enable `xfs-control`.

## Implementation phases

### Phase 1: Public Tripley Kit facade alignment

Deliverables:

- Update `@tripley-kit/xfs-client` to expose all supported module clients through the public package entry.
- Add optional `requiredModules`.
- Add package tests proving BCR, CDM, CIM, IDC, PIN, PTR, SIU, TTU, and VDM are resolved or fail with clear messages.

Exit criteria:

- Framework code can import only from `@tripley-kit/xfs-client`.
- No deep import from `generated/client`.

### Phase 2: Native connection adapter package

Deliverables:

- Add `packages/native-tripley-kit`.
- Provide WebSocket/Tauri/Electron connection factories.
- Wire `TripleyNativeAdapter`.
- Add fail-fast capability checks for window, display, SQLite, TTS, secure storage, and runtime.
- Add kiosk preset option for hostd URL and auth token.

Exit criteria:

- Browser example can connect to hostd native services.
- Missing display/window capability fails before kiosk boot.

### Phase 3: XFS device service package

Deliverables:

- Add `packages/xfs-device-service`.
- Implement `XfsDeviceService`.
- Implement logical service session lifecycle.
- Register IDC, PIN, BCR, and CDM devices first.
- Register `pinpad.data`, `pinpad.pin`, `barcodeReader.qr`, and `cardReader.track` adapters.
- Add health checks for configured logical services.
- Add event mapping to framework event bus.

Exit criteria:

- DeviceRegistry lists configured XFS devices.
- InputSourceRegistry starts XFS-backed input sources without UserInput executor changes.
- Cancelling a userInput node cancels active XFS requests.

### Phase 4: Simulator automation harness

Deliverables:

- Add `packages/xfs-test-harness`.
- Provide helpers for simulator reset, logical service setup, card insertion/removal, PIN key press, BCR read completion, and cash unit profile setup.
- Add test fixtures for hostd URL/auth.
- Mark tests as integration tests requiring simulator.

Exit criteria:

- Tests can drive the simulator through xfs-control without manual UI interaction.
- Simulator helpers are absent from production dependencies.

### Phase 5: Kiosk example integration

Deliverables:

- Extend `apps/kiosk-example` with a hostd-backed mode.
- Keep existing in-memory demo mode as fallback for CI without simulator.
- Show card insert, amount entry, optional QR, secure PIN, command invocation, scoped store reset, audit/EJ record, timeout/interrupt, and safe logging metadata.
- Add project device plugin example registering one custom input source.

Exit criteria:

- Example runs in browser using WebSocket hostd.
- Example can switch between simulator-backed and in-memory modes by configuration.
- Project-specific device plugin works without core modification.

### Phase 6: End-to-end validation suite

Deliverables:

- Unit tests for adapters and redaction.
- Contract tests for logical service configuration.
- Integration tests with hostd and xfs-control.
- Browser smoke test for native + XFS over WebSocket.

Required test cases:

- Dynamic `minLength` and `maxLength` flow input still work with XFS pinpad data.
- Local validation failure stays on the same userInput node and updates UI feedback.
- Secure PIN input logs only safe summary.
- Timeout, interrupt, and node exit cancel active XFS requests.
- BCR optional QR source can win or lose a race and is cancelled correctly.
- Simulator card removal maps to flow interrupt.
- Custom project device plugin registers without modifying core.

## Open grilling questions

1. Which XFS logical service names are canonical for the installed simulator on this PC: `IDC30`, `PIN30`, `BCR30`, `CDM30`, or different names?
2. Should the first production vertical slice be card-first withdrawal, QR-first withdrawal, or no-card demo withdrawal?
3. Is CDM dispense required in the first simulator-backed example, or is read/input/auth enough for the first milestone?
4. Should hostd startup be managed by tests, or should tests assume an already running hostd?
5. What is the production default: WebSocket hostd from browser, Tauri host bridge, Electron addon, or all three supported equally?
6. Are PIN key slots and PIN block formats project configuration, bank plugin configuration, or environment secrets?
7. Should raw XFS `hResult` codes be exposed to business validation nodes, or normalized into framework error codes only?
8. Do we require x86 hostd for all Windows simulator tests, or do we also keep a mock XFS provider for CI?

## Recommended first milestone

Start with IDC, PIN, and BCR. Do not start with CDM dispense.

Reasoning:

- IDC/PIN/BCR prove connection, sessions, events, input source cancellation, secure input redaction, and simulator automation.
- CDM adds cash unit accounting and dispense/present/retract state, which is important but will slow down the first validation loop.
- The current framework already has a withdrawal-like flow where amount, QR, PIN, timeout, interrupt, and audit behavior are the highest-risk integration points.

Milestone acceptance:

- `@tripley-kit/xfs-client` exposes all required module clients publicly.
- Browser example connects to hostd over WebSocket.
- Simulator automation can insert a card, complete a QR read, and press PIN keys.
- Flow completes a secure-input path without logging sensitive values.
- No framework core package imports `@tripley-kit/xfs-client` except the new XFS device service package.
