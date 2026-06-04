# @tripley-acctron/testing

Headless UI, virtual clock, fake devices, fake host, and test app helpers.

Update this document when test helpers or fake device behavior changes.

## Virtual Clock

`VirtualClock` implements the framework `Clock` contract and returns cancellable timers, so timeout
tests can advance time deterministically.

## Fake Devices

`FakePinpad` supports `press()` and async `waitKey()`.
`FakeBarcodeReader` supports `scan()` and async `read()`.
`FakeCardReader` supports card insertion, eject, retain, cancel, and status.
`FakeCashDispenser` records dispense requests and supports reject, retract, cancel, and status.
`FakePrinter` records print/cut calls and supports cancel/status.

Device fakes record calls and expose cancellation state, allowing tests to verify source cleanup and
recovery behavior.

## Fake Host

`FakeHostGateway` implements the framework `HostGateway` contract, records sent requests, and supports
queued responses or failures.

## Test App

`createTestKioskApp` wires headless UI, fake devices, `VirtualClock`, `DefaultTimeoutService`,
`InMemoryTransactionResourceRegistry`, `DefaultRecoveryManager`, in-memory EJ, default redaction, and
default interaction audit into `FlowEngine`.

It also wires `InMemoryTransactionDataStore`, `NoopTtsService`, headless voice guide audio, and
`HeadlessWindowManager`, so recipes and Milestone 10 services can be tested without real UI,
hardware, audio, or native windows.

Tests can pass `host` to `createTestKioskApp` to make Host Gateway calls available in step context.

Tests can pass `journal`, `redaction`, or `audit` to replace the default observability services.

Tests can pass `transaction`, `tts`, `voiceGuide`, or `windows` to replace the default Milestone 10
services.
