# @tripley-kit/web-container-kiosk-host-native-channel

Native TCP and WebSocket `HostWireTransportAdapter` implementations for Tripley kiosk applications.

## Boundaries

- Uses injected structural ports compatible with `@tripley-kit/native`.
- Registers channels through `HostWireTransportRegistry`.
- Never falls back to browser TCP or browser WebSocket APIs.
- Reports conservative `notSent`, `unknown`, or `response` delivery certainty.
- Does not log request or response payloads.

## TCP channel

```ts
import {
  createAsciiLengthPrefixFrameCodec,
  registerNativeHostChannels,
} from "@tripley-kit/web-container-kiosk-host-native-channel";

const runtime = registerNativeHostChannels({
  native,
  registry,
  tcp: [{
    id: "native.tcp.primary",
    host: "127.0.0.1",
    port: 7001,
    security: { mode: "plain" },
    connectTimeoutMs: 5_000,
    writeTimeoutMs: 5_000,
    responseTimeoutMs: 15_000,
    frame: createAsciiLengthPrefixFrameCodec({
      prefixBytes: 4,
      lengthIncludesPrefix: false,
      maxFrameBytes: 64 * 1024,
    }),
  }],
});
```

Call `runtime.dispose()` during application shutdown or native capability loss.

## Configurable BCD framing

Bank-specific framing belongs in project composition, not the TCP adapter:

```ts
import { createLengthPrefixFrameCodec } from "@tripley-kit/web-container-kiosk-host-native-channel";

const frame = createLengthPrefixFrameCodec({
  fixedHeader: Uint8Array.of(0x0f, 0x0f, 0x0f),
  lengthBytes: 3,
  lengthEncoding: "bcd",
  lengthIncludesFixedHeader: true,
  lengthIncludesLengthField: true,
  maxFrameBytes: 64 * 1024,
});
```

Custom protocols can implement `HostFrameCodec` and use the same native TCP adapter without core changes.
