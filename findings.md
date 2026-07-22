# Target 52 Findings

- `@tripley-kit/native` already exposes typed TCP client methods: `connect`, `write`, `end`, `close`, and `onEvent`.
- The same package exposes WebSocket client methods and event subscriptions.
- The host simulator supports real TCP, HTTP, and WebSocket listeners plus framing, fixed-field, ISO8583, JSON, and runtime logs.
- The simulator has a generic non-ISO sample using a four-byte ASCII length prefix, but the active BSP production-test listener uses a different frame contract.
- No separate hostd `tcp.rs` exists; generic native networking is implemented through the core generated service surface.
- Target 51 currently expects one atomic wire exchange adapter. Target 52 should implement that atom over native socket lifecycle and classify certainty at the write acceptance boundary.
- Native `write` does not expose a proven zero-byte failure result. Conservatively, only connect-stage failures are `notSent`; every failure after write dispatch begins is `unknown`.
- The Taiwan ATM message specification is deferred to project code after the generic channel is proven.
- Native TCP uses Tokio `write_all`; an error may follow a partial write, confirming that write errors must be `unknown`.
- `tripley-native-hostd --services` already accepts `tcp` and `websocket`; no Rust/hostd source change is required for this target.
- The active BSP listener uses `127.0.0.1:12008`, fixed header `0F 0F 0F`, three-byte BCD length, and a declared length that includes the fixed header and length field.
- Simulator listeners are started by a Tauri command from the UI and are not automatically active merely because the executable is running.
- The BSP recognizer reads the three-character transaction code at body offsets 8 through 10. A padded 726-byte `AEX` request exercises a default response without account, PIN, or transaction data.
- A bare TCP readiness probe is invalid for the debug hostd WebSocket listener and can terminate that process; smoke readiness must use a WebSocket client or a process-stability wait.
