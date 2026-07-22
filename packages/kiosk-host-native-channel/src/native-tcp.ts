import {
  HostChannelTimeoutError,
  SerialTaskQueue,
  deferred,
  remainingTimeoutMs,
  withTimeout,
} from "./async-tools";
import { appendBytes } from "./bytes";
import type {
  DisposableHostWireTransportAdapter,
  HostChannelRequest,
  HostChannelResult,
  NativeEventSubscription,
  NativeTcpApi,
  NativeTcpEvent,
  NativeTcpHostTransportConfig,
} from "./contracts";
import type { HostFrameDecodeResult } from "./framing";

interface TcpResponse {
  readonly status: "response" | "failed";
  readonly payload?: Uint8Array;
  readonly errorCode?: string;
}

export class NativeTcpHostTransportAdapter implements DisposableHostWireTransportAdapter {
  public readonly id: string;
  private readonly queue = new SerialTaskQueue();
  private disposed = false;
  private cancelActive?: (() => void) | undefined;

  public constructor(
    private readonly tcp: NativeTcpApi,
    private readonly config: NativeTcpHostTransportConfig,
  ) {
    validateConfig(tcp, config);
    this.id = config.id;
  }

  public exchange(request: HostChannelRequest): Promise<HostChannelResult> {
    return this.queue.run(() => this.performExchange(request));
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
    this.cancelActive?.();
  }

  private async performExchange(request: HostChannelRequest): Promise<HostChannelResult> {
    if (this.disposed) return failure("notSent", "host.channel.disposed");
    const deadline = Date.now() + Math.max(1, request.timeoutMs);
    let framed: Uint8Array;
    try {
      framed = this.config.frame.encode(request.payload);
    } catch {
      return failure("notSent", "host.channel.request-frame-invalid");
    }
    const response = deferred<TcpResponse>();
    let socketId: string | undefined;
    let received: Uint8Array = new Uint8Array();
    let subscription: NativeEventSubscription | undefined;
    try {
      subscription = this.tcp.onEvent((event) => {
        if (event.id !== socketId) return;
        received = handleEvent(event, received, this.config, response.resolve);
      });
      socketId = await this.connect(deadline);
    } catch (error) {
      subscription?.unsubscribe();
      return failure("notSent", connectErrorCode(error));
    }
    if (this.disposed) {
      subscription?.unsubscribe();
      await this.tcp.close(socketId).catch(() => undefined);
      return failure("notSent", "host.channel.disposed");
    }
    this.cancelActive = () =>
      response.resolve({
        errorCode: "host.channel.disposed-after-connect",
        status: "failed",
      });
    try {
      await withTimeout(
        this.tcp.write(socketId, framed),
        remainingTimeoutMs(deadline, this.config.writeTimeoutMs),
        "host.channel.write-timeout",
      );
      const receivedResponse = await withTimeout(
        response.promise,
        remainingTimeoutMs(deadline, this.config.responseTimeoutMs),
        "host.channel.response-timeout",
      );
      if (receivedResponse.status === "failed" || !receivedResponse.payload) {
        return failure("unknown", receivedResponse.errorCode ?? "host.channel.response-failed");
      }
      return {
        payload: receivedResponse.payload,
        responseId: `${request.idempotencyKey}:response`,
        status: "response",
      };
    } catch (error) {
      return failure("unknown", dispatchErrorCode(error));
    } finally {
      this.cancelActive = undefined;
      subscription?.unsubscribe();
      await this.tcp.close(socketId).catch(() => undefined);
    }
  }

  private async connect(deadline: number): Promise<string> {
    const timeoutMs = remainingTimeoutMs(deadline, this.config.connectTimeoutMs);
    const connectTls = this.tcp.connectTls;
    const connection =
      this.config.security.mode === "tls" && connectTls
        ? connectTls.call(this.tcp, this.config.host, this.config.port, this.config.security)
        : this.tcp.connect(this.config.host, this.config.port);
    try {
      return await withTimeout(connection, timeoutMs, "host.channel.connect-timeout");
    } catch (error) {
      void connection.then((lateSocket) => this.tcp.close(lateSocket)).catch(() => undefined);
      throw error;
    }
  }
}

const handleEvent = (
  event: NativeTcpEvent,
  received: Uint8Array,
  config: NativeTcpHostTransportConfig,
  resolve: (response: TcpResponse) => void,
): Uint8Array => {
  if (event.kind === "error" || event.kind === "close") {
    resolve({ errorCode: `host.channel.remote-${event.kind}`, status: "failed" });
    return received;
  }
  if (event.kind !== "data" || !event.data) return received;
  const next = appendBytes(received, event.data);
  resolveDecoded(config.frame.decode(next), next.length, resolve);
  return next;
};

const resolveDecoded = (
  decoded: HostFrameDecodeResult,
  receivedBytes: number,
  resolve: (response: TcpResponse) => void,
): void => {
  if (decoded.status === "invalid") {
    resolve({ errorCode: decoded.errorCode, status: "failed" });
  } else if (decoded.status === "complete" && decoded.consumedBytes !== receivedBytes) {
    resolve({ errorCode: "host.channel.trailing-response-bytes", status: "failed" });
  } else if (decoded.status === "complete") {
    resolve({ payload: decoded.payload, status: "response" });
  }
};

const failure = (status: "notSent" | "unknown", errorCode: string): HostChannelResult => ({
  errorCode,
  status,
});

const connectErrorCode = (error: unknown): string =>
  error instanceof HostChannelTimeoutError ? error.code : "host.channel.connect-failed";

const dispatchErrorCode = (error: unknown): string =>
  error instanceof HostChannelTimeoutError ? error.code : "host.channel.write-failed";

const validateConfig = (tcp: NativeTcpApi, config: NativeTcpHostTransportConfig): void => {
  if (
    !config.id ||
    !config.host ||
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65_535 ||
    config.connectTimeoutMs <= 0 ||
    config.writeTimeoutMs <= 0 ||
    config.responseTimeoutMs <= 0
  ) {
    throw new Error("host.channel.tcp-config-invalid");
  }
  if (config.security.mode === "tls" && !tcp.connectTls) {
    throw new Error("host.channel.tls-capability-required");
  }
};
