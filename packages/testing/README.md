# @tripley-acctron/testing

Headless UI, virtual clock, fake devices, fake host, and test app helpers.

Update this document when test helpers or fake device behavior changes.

## Virtual Clock

`VirtualClock` implements the framework `Clock` contract and returns cancellable timers, so timeout
tests can advance time deterministically.

## Fake Devices

`FakePinpad` supports `press()` and async `waitKey()`.
`FakeBarcodeReader` supports `scan()` and async `read()`.

Both fakes record calls and expose `cancelled`, allowing tests to verify source cleanup.

## Test App

`createTestKioskApp` wires headless UI, fake devices, `VirtualClock`, and `DefaultTimeoutService`
into `FlowEngine`, so standard step builders can be tested without real UI or hardware.
