# Native Required Capabilities

This document records native capabilities required by Tripley Acctron but not yet available through `E:\code\rust\tripley-native` IDL and generated `@tripley-kit/native` client.

V1 uses existing native SDK capabilities only.

## Future IDL Requests

- Pinpad key mode, secure PIN entry, cancel, and key events.
- Barcode reader scan, cancel, and scan events.
- Card reader wait, eject, retain, cancel, and card status events.
- Cash dispenser dispense, reject, retract, status, and error events.
- Receipt printer print, cut, status, and error events.
- Device inventory and health/status query.
- Window coordination for customer, supervisor, operator, and diagnostic screens.
- Audio/TTS playback hooks if browser TTS is insufficient.
