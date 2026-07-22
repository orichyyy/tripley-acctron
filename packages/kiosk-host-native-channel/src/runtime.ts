import type {
  HostWireTransportAdapter,
  HostWireTransportRegistry,
} from "@tripley-kit/web-container-kiosk-host-integration";

import type {
  NativeTcpApi,
  NativeTcpHostTransportConfig,
  NativeWebSocketApi,
  NativeWebSocketHostTransportConfig,
} from "./contracts";
import { NativeTcpHostTransportAdapter } from "./native-tcp";
import { NativeWebSocketHostTransportAdapter } from "./native-websocket";

export interface NativeHostChannelServices {
  readonly tcp?: NativeTcpApi | undefined;
  readonly websocket?: NativeWebSocketApi | undefined;
}

export interface NativeHostChannelRuntimeOptions {
  readonly native: NativeHostChannelServices;
  readonly registry: HostWireTransportRegistry;
  readonly tcp?: readonly NativeTcpHostTransportConfig[] | undefined;
  readonly websocket?: readonly NativeWebSocketHostTransportConfig[] | undefined;
}

export interface NativeHostChannelRuntime {
  readonly adapters: readonly HostWireTransportAdapter[];
  dispose(): Promise<void>;
}

export const registerNativeHostChannels = (
  options: NativeHostChannelRuntimeOptions,
): NativeHostChannelRuntime => {
  const adapters = createAdapters(options);
  for (const adapter of adapters) options.registry.register(adapter);
  return {
    adapters,
    dispose: async () => {
      await Promise.all(adapters.map((adapter) => adapter.dispose()));
    },
  };
};

const createAdapters = (
  options: NativeHostChannelRuntimeOptions,
): Array<NativeTcpHostTransportAdapter | NativeWebSocketHostTransportAdapter> => {
  const adapters: Array<NativeTcpHostTransportAdapter | NativeWebSocketHostTransportAdapter> = [];
  const tcp = options.native.tcp;
  if (options.tcp?.length) {
    if (!tcp) throw new Error("host.channel.native-tcp-capability-required");
    for (const config of options.tcp) {
      adapters.push(new NativeTcpHostTransportAdapter(tcp, config));
    }
  }
  const websocket = options.native.websocket;
  if (options.websocket?.length) {
    if (!websocket) throw new Error("host.channel.native-websocket-capability-required");
    for (const config of options.websocket) {
      adapters.push(new NativeWebSocketHostTransportAdapter(websocket, config));
    }
  }
  return adapters;
};
