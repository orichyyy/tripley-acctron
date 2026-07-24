# Target 58: Taiwan BSP v2.43 Host Simulator Smoke

## Objective

Prove the Target 57 withdrawal host runtime against the production-test
`tripley-host-simulator` through `tripley-native-hostd`, not an in-memory socket.

## Scope

- Start an isolated hostd with `runtime,tcp` services.
- Connect hostd to the simulator TCP listener on `127.0.0.1:12008`.
- Establish the persistent BSP session with OEX.
- Execute one IWD withdrawal authorization.
- Execute one optional IWF Host Financial Completion.
- Validate session readiness, authorization approval, and terminal health.
- Print only a safe result summary.

## Simulator Prerequisite

The simulator project must expose a running TCP listener with:

- fixed header `0F 0F 0F`;
- three-byte BCD length;
- length is the complete wire-buffer length;
- `HEADER_3` is `01`;
- `HEADER_4` is a three-byte ASCII counter from `000` through `999`;
- `HEADER_5` and `HEADER_6` are `0F`;
- persistent connection support;
- OEX request/reply;
- IWD request/reply with an accepted reject code and center transaction sequence;
- IWF request/reply with an accepted reject code.

The BSP application message profile remains compiled in this repository. The
simulator configuration is only a test peer and is not loaded by the kiosk
application.

## Command

```powershell
pnpm test:bsp-v243-host-simulator
```

Optional parameters can be supplied directly to
`scripts/test-bsp-v243-host-simulator.ps1`.

## Safety

- The runner starts and stops only its isolated hostd process.
- The simulator process and listener are never stopped by the runner.
- Smoke credentials are synthetic.
- Raw requests, responses, account values, PIN blocks, and cryptographic fields
  are not written to stdout.
- Normal workspace tests skip this external smoke unless explicitly enabled.

## Acceptance

- Missing simulator listener fails before hostd startup with an actionable error.
- Missing hostd/native artifacts fail with their exact path.
- OEX makes the session supervisor ready.
- IWD returns an approved authorization.
- IWF returns successfully.
- Disposal closes native TCP and WebSocket resources.
