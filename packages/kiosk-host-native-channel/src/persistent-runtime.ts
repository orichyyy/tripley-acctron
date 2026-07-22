import type {
  HostWireTransportAdapter,
  HostWireTransportRegistry,
} from "@tripley-kit/web-container-kiosk-host-integration";

import type { NativeTcpApi } from "./contracts";
import type { PersistentNativeTcpHostSessionConfig } from "./persistent-contracts";
import { PersistentNativeTcpHostSession } from "./persistent-session";

export interface PersistentNativeHostServices {
  readonly tcp?: NativeTcpApi | undefined;
}

export interface PersistentNativeHostRuntimeOptions {
  readonly native: PersistentNativeHostServices;
  readonly registry: HostWireTransportRegistry;
  readonly tcp: readonly PersistentNativeTcpHostSessionConfig[];
}

export interface PersistentNativeHostRuntime {
  readonly sessions: readonly (PersistentNativeTcpHostSession & HostWireTransportAdapter)[];
  start(): Promise<void>;
  dispose(): Promise<void>;
}

export const registerPersistentNativeHostSessions = (
  options: PersistentNativeHostRuntimeOptions,
): PersistentNativeHostRuntime => {
  const tcp = options.native.tcp;
  if (options.tcp.length > 0 && !tcp) {
    throw new Error("host.session.native-tcp-capability-required");
  }
  const sessions = tcp
    ? options.tcp.map((config) => new PersistentNativeTcpHostSession(tcp, config))
    : [];
  for (const session of sessions) options.registry.register(session);
  return {
    sessions,
    start: async () => {
      await Promise.all(sessions.map((session) => session.start()));
    },
    dispose: async () => {
      await Promise.all(sessions.map((session) => session.dispose()));
    },
  };
};
