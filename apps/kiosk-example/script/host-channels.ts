import type { HostWireTransportRegistry } from "@tripley-kit/web-container-kiosk-host-integration";
import {
  type HostFrameCodec,
  type NativeHostChannelServices,
  createAsciiLengthPrefixFrameCodec,
  registerNativeHostChannels,
} from "@tripley-kit/web-container-kiosk-host-native-channel";

export interface ExampleHostChannelConfig {
  readonly host: string;
  readonly port: number;
  readonly frame?: HostFrameCodec | undefined;
  readonly connectTimeoutMs?: number | undefined;
  readonly responseTimeoutMs?: number | undefined;
}

export const createExampleHostChannels = (
  native: NativeHostChannelServices,
  registry: HostWireTransportRegistry,
  config: ExampleHostChannelConfig,
) =>
  registerNativeHostChannels({
    native,
    registry,
    tcp: [
      {
        connectTimeoutMs: config.connectTimeoutMs ?? 5_000,
        frame:
          config.frame ??
          createAsciiLengthPrefixFrameCodec({
            lengthIncludesPrefix: false,
            maxFrameBytes: 16 * 1024,
            prefixBytes: 4,
          }),
        host: config.host,
        id: "native.tcp.primary",
        port: config.port,
        responseTimeoutMs: config.responseTimeoutMs ?? 15_000,
        security: { mode: "plain" },
        writeTimeoutMs: 5_000,
      },
    ],
  });
