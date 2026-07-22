# Target 52: Native Host Channel Vertical Slice

## Objective

Connect Target 51 host messaging to the typed `@tripley-kit/native` TCP and WebSocket APIs, with conservative delivery certainty, bounded framing, deterministic cleanup, and a real TCP smoke path through `tripley-native-hostd` to the production test host simulator.

## Architecture

- `@tripley-kit/web-container-kiosk-host-native-channel` implements Target 51 `HostWireTransportAdapter` plugins.
- The package accepts structural native ports matching `TripleyNative.tcp` and `TripleyNative.websocket`; core does not create native clients or depend on a browser API.
- `registerNativeHostChannels` performs capability fail-fast and contributes configured adapters to `HostWireTransportRegistry`.
- TCP uses one socket per exchange and serializes exchanges per adapter. This avoids response-correlation ambiguity for protocols whose correlation fields are available only after message decode.
- WebSocket uses one native message as one host response.
- TCP framing is a plugin contract. Built-in codecs cover ASCII length prefixes and configurable ASCII/BCD length prefixes with optional fixed headers.

## Delivery certainty

| Stage | Result |
|---|---|
| Local framing/configuration failure | `notSent` |
| Native connect failure or connect timeout | `notSent` |
| Adapter disposed before dispatch | `notSent` |
| Native write/send failure or timeout | `unknown` |
| Remote close/error after connect | `unknown` |
| Response timeout, invalid frame, oversized response | `unknown` |
| Complete framed/message response | `response` |

`TcpApi.write` is backed by Tokio `write_all`. An error can follow a partial network write, so write errors are never considered safe to retry automatically.

## Security and lifecycle

- Frame and message limits are checked before allocation or business decode.
- Raw requests and responses are not logged by the channel.
- Event subscriptions and sockets are released on every terminal path.
- Plain TCP must be explicitly configured.
- TLS configuration requires an injected native `connectTls` capability; absence fails during adapter construction.
- WebSocket TLS-required configuration accepts only `wss:` URLs.
- Browser `WebSocket` and browser TCP fallbacks are prohibited.

## Simulator smoke

1. Start `tripley-host-simulator.exe`.
2. In the simulator UI, start the BSP TCP listener on `127.0.0.1:12008`. Its ingress frame uses fixed header `0F 0F 0F`, a three-byte BCD length, and a declared length that includes both header and length field.
3. Run `pnpm test:host-simulator`.

The script starts an isolated `tripley-native-hostd` on port 39012 with `runtime,tcp`, sends a padded non-sensitive `AEX` body, validates the BCD-framed response, and stops only the hostd process it created. The smoke does not log request or response payloads.

## Project boundary

Bank message profiles and field mappings remain application scripts. The Taiwan ATM v2.43 specification will be implemented as a later project package after this channel foundation is accepted.

## Acceptance

- TCP and WebSocket success, failure certainty, timeout, TLS policy, and cleanup tests pass.
- Missing configured native capabilities fail before registration.
- A Host Message response crosses native TCP framing and Target 51 safe-summary processing.
- The real simulator TCP smoke passes without modifying the simulator or native repositories.
