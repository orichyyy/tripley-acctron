# Native Required Capabilities

This document records native capabilities required by Tripley Acctron but not yet available through `E:\code\rust\tripley-native` IDL and generated `@tripley-kit/native` client.

V1 uses existing native SDK capabilities only.

Milestone 7 adds TypeScript framework contracts, fake devices, and recovery behavior for ATM devices.
The current `E:\code\rust\tripley-native` IDL aggregate imports runtime, filesystem, archive, TCP,
WebSocket, SQLite, and system services only, so the ATM device calls below still need native IDL
support before a real device adapter can be implemented.

## Future IDL Requests

- Pinpad key mode, secure PIN entry, cancel, and key events.
- Barcode reader scan, cancel, and scan events.
- Card reader wait, eject, retain, cancel, and card status events.
- Cash dispenser dispense, reject, retract, status, and error events.
- Receipt printer print, cut, status, and error events.
- Device inventory and health/status query.
- Window coordination for customer, supervisor, operator, and diagnostic screens.
- Audio/TTS playback hooks if browser TTS is insufficient.

Milestone 10 adds TypeScript contracts plus headless/browser implementations for window coordination
and audio guidance. The native implementations remain blocked until `tripley-native` exposes window
and audio/TTS IDL in the generated `@tripley-kit/native` client.
