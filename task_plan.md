# Target 52: Native Host Channel Vertical Slice

## Objective

Implement a production-oriented native TCP/WebSocket host channel, bind it to Target 51 durable host messaging, and prove a real withdrawal/deposit authorization path against the production test host simulator without coupling core to a bank-specific message specification.

## Phases

1. **Native and simulator seam discovery** - complete
2. **Target 52 contract and certainty policy** - complete
3. **Native channel runtime and lifecycle implementation** - complete
4. **Kiosk composition and simulator smoke** - complete
5. **Validation, review, commit, and publish** - complete

## Required behavior

- TCP/WebSocket channels use typed native APIs and never browser socket fallbacks.
- Capability absence fails before transaction execution.
- Connect/write failure before accepted dispatch is `notSent`.
- Timeout, close, or error after accepted write is `unknown`.
- Complete framed responses are `response` and are processed by Target 51.
- Maximum frame size, connect timeout, response timeout, and TLS policy are explicit configuration.
- Event subscriptions and sockets are always released on success, failure, timeout, and disposal.
- TCP requests are serialized per adapter and use one socket per exchange, avoiding response-correlation ambiguity.
- TLS-required configuration fails fast unless an injected native TCP implementation exposes `connectTls`.
- Real simulator smoke proves fixed-field request/response over TCP.
- Bank-specific profiles remain under application script code.

## Errors

| Error | Attempts | Resolution |
|---|---:|---|
| Combined simulator regex had an unclosed escaped quote | 1 | Split discovery into fixed, single-quoted searches and do not reuse the malformed expression. |
| First native-channel typecheck found a one-argument test mock and narrow empty Uint8Array inference | 1 | Declare the mock data argument and widen the response accumulator type explicitly. |
| Runtime test could not resolve the newly added workspace dependency | 1 | Run workspace install once to create the new package dependency symlinks and lock entry. |
| Example Vite test ran before the new package produced its dist export | 1 | Build the new package before running package-name imports in the example suite. |
| pnpm forwarded `--` as an empty PowerShell parameter | 1 | Invoke the parameterized PowerShell smoke script directly; keep the package script's default simulator port usable without arguments. |
| Smoke cleanup hid the original native connection error | 1 | Track successful native connection and call native dispose only after connect succeeds. |
| Bare TCP readiness probe terminated the debug WebSocket hostd | 1 | Replace the protocol-invalid probe with a bounded process-stability wait; the real native WebSocket client performs readiness validation. |
| Initial generic simulator frame timed out | 1 | Read the active BSP listener metadata and add the configurable fixed-header BCD codec required by its production framing. |
| `Required<T>` retained `undefined` in normalized frame options | 1 | Introduce an explicit internal normalized options type. |
