# @tripley-acctron/testing

Headless UI, virtual clock, fake devices, fake host, and test app helpers.

Update this document when test helpers or fake device behavior changes.

## Virtual Clock

`VirtualClock` implements the framework `Clock` contract and returns cancellable timers, so timeout
tests can advance time deterministically.
