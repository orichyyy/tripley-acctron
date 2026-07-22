import type { HostWireTransportRegistry } from "@tripley-kit/web-container-kiosk-host-integration";
import {
  type HostFrameCodec,
  type HostInboundMessageRegistry,
  type NativeTcpApi,
  type PersistentHostFrameRouteInput,
  registerPersistentNativeHostSessions,
} from "@tripley-kit/web-container-kiosk-host-native-channel";

export interface ExamplePersistentHostChannelConfig {
  readonly frame: HostFrameCodec;
  readonly host: string;
  readonly inbound: HostInboundMessageRegistry;
  readonly port: number;
  routeFrame(
    input: PersistentHostFrameRouteInput,
  ):
    | { readonly kind: "response"; readonly responseId?: string | undefined }
    | { readonly kind: "inbound"; readonly type: string; readonly messageId?: string | undefined }
    | { readonly kind: "ignore"; readonly reason: string };
}

export const createExamplePersistentHostChannel = (
  tcp: NativeTcpApi,
  registry: HostWireTransportRegistry,
  config: ExamplePersistentHostChannelConfig,
) =>
  registerPersistentNativeHostSessions({
    native: { tcp },
    registry,
    tcp: [
      {
        connectTimeoutMs: 5_000,
        frame: config.frame,
        host: config.host,
        id: "native.tcp.persistent",
        inbound: config.inbound,
        port: config.port,
        reconnect: { initialDelayMs: 500, maxDelayMs: 30_000, multiplier: 2 },
        responseTimeoutMs: 15_000,
        routeFrame: config.routeFrame,
        security: { mode: "plain" },
        writeTimeoutMs: 5_000,
      },
    ],
  });
