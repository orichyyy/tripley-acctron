import type { HostWireExchangeResult } from "@tripley-kit/web-container-kiosk-host-integration";

import { HostChannelTimeoutError, withTimeout } from "./async-tools";
import type { NativeTcpApi } from "./contracts";
import type { PersistentNativeTcpHostSessionConfig } from "./persistent-contracts";

export const persistentFailure = (
  status: "notSent" | "unknown",
  errorCode: string,
): HostWireExchangeResult => ({ errorCode, status });

export const persistentConnectErrorCode = (error: unknown): string =>
  error instanceof HostChannelTimeoutError ? error.code : "host.session.connect-failed";

export const persistentDispatchErrorCode = (error: unknown): string =>
  error instanceof HostChannelTimeoutError ? error.code : "host.session.write-failed";

export const connectPersistentSocket = async (
  tcp: NativeTcpApi,
  config: PersistentNativeTcpHostSessionConfig,
  retireLateSocket: (socketId: string) => void,
): Promise<string> => {
  const connectTls = tcp.connectTls;
  const operation =
    config.security.mode === "tls" && connectTls
      ? connectTls.call(tcp, config.host, config.port, config.security)
      : tcp.connect(config.host, config.port);
  try {
    return await withTimeout(operation, config.connectTimeoutMs, "host.session.connect-timeout");
  } catch (error) {
    void operation
      .then((lateSocket) => {
        retireLateSocket(lateSocket);
        return tcp.close(lateSocket);
      })
      .catch(() => undefined);
    throw error;
  }
};

export const validatePersistentSessionConfig = (
  tcp: NativeTcpApi,
  config: PersistentNativeTcpHostSessionConfig,
): void => {
  if (
    !config.id ||
    !config.host ||
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65_535 ||
    config.connectTimeoutMs <= 0 ||
    config.writeTimeoutMs <= 0 ||
    config.responseTimeoutMs <= 0 ||
    config.reconnect.initialDelayMs <= 0 ||
    config.reconnect.maxDelayMs < config.reconnect.initialDelayMs ||
    config.reconnect.multiplier < 1
  ) {
    throw new Error("host.session.tcp-config-invalid");
  }
  if (config.security.mode === "tls" && !tcp.connectTls) {
    throw new Error("host.session.tls-capability-required");
  }
};
