import {
  HostChannelTimeoutError,
  SerialTaskQueue,
  deferred,
  remainingTimeoutMs,
  withTimeout,
} from "./async-tools";
import type {
  DisposableHostWireTransportAdapter,
  HostChannelRequest,
  HostChannelResult,
  NativeEventSubscription,
  NativeWebSocketApi,
  NativeWebSocketEvent,
  NativeWebSocketHostTransportConfig,
} from "./contracts";

interface WebSocketResponse {
  readonly status: "response" | "failed";
  readonly payload?: Uint8Array;
  readonly errorCode?: string;
}

export class NativeWebSocketHostTransportAdapter implements DisposableHostWireTransportAdapter {
  public readonly id: string;
  private readonly queue = new SerialTaskQueue();
  private disposed = false;
  private cancelActive?: (() => void) | undefined;

  public constructor(
    private readonly websocket: NativeWebSocketApi,
    private readonly config: NativeWebSocketHostTransportConfig,
  ) {
    validateConfig(config);
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
    if (request.payload.length > this.config.maxMessageBytes) {
      return failure("notSent", "host.channel.request-too-large");
    }
    const response = deferred<WebSocketResponse>();
    let socketId: string | undefined;
    let subscription: NativeEventSubscription | undefined;
    try {
      subscription = this.websocket.onEvent((event) => {
        if (event.id === socketId) handleEvent(event, this.config, response.resolve);
      });
      socketId = await this.connect(deadline);
    } catch (error) {
      subscription?.unsubscribe();
      return failure("notSent", connectErrorCode(error));
    }
    if (this.disposed) {
      subscription?.unsubscribe();
      await this.websocket.close(socketId).catch(() => undefined);
      return failure("notSent", "host.channel.disposed");
    }
    this.cancelActive = () =>
      response.resolve({
        errorCode: "host.channel.disposed-after-connect",
        status: "failed",
      });
    try {
      await this.send(socketId, request, deadline);
      const received = await withTimeout(
        response.promise,
        remainingTimeoutMs(deadline, this.config.responseTimeoutMs),
        "host.channel.response-timeout",
      );
      if (received.status === "failed" || !received.payload) {
        return failure("unknown", received.errorCode ?? "host.channel.response-failed");
      }
      return {
        payload: received.payload,
        responseId: `${request.idempotencyKey}:response`,
        status: "response",
      };
    } catch (error) {
      return failure("unknown", dispatchErrorCode(error));
    } finally {
      this.cancelActive = undefined;
      subscription?.unsubscribe();
      await this.websocket.close(socketId).catch(() => undefined);
    }
  }

  private async connect(deadline: number): Promise<string> {
    const connection = this.websocket.connect(this.config.url);
    try {
      return await withTimeout(
        connection,
        remainingTimeoutMs(deadline, this.config.connectTimeoutMs),
        "host.channel.connect-timeout",
      );
    } catch (error) {
      void connection.then((lateSocket) => this.websocket.close(lateSocket)).catch(() => undefined);
      throw error;
    }
  }

  private send(socketId: string, request: HostChannelRequest, deadline: number): Promise<void> {
    const dispatch =
      this.config.requestKind === "binary"
        ? this.websocket.sendBinary(socketId, request.payload)
        : this.websocket.sendText(socketId, new TextDecoder().decode(request.payload));
    return withTimeout(
      dispatch,
      remainingTimeoutMs(deadline, this.config.sendTimeoutMs),
      "host.channel.write-timeout",
    );
  }
}

const handleEvent = (
  event: NativeWebSocketEvent,
  config: NativeWebSocketHostTransportConfig,
  resolve: (response: WebSocketResponse) => void,
): void => {
  if (event.kind === "error" || event.kind === "close") {
    resolve({ errorCode: `host.channel.remote-${event.kind}`, status: "failed" });
    return;
  }
  const payload = eventPayload(event, config.responseKind);
  if (!payload) {
    if (event.kind === "binary" || event.kind === "text") {
      resolve({ errorCode: "host.channel.response-kind-invalid", status: "failed" });
    }
    return;
  }
  if (payload.length > config.maxMessageBytes) {
    resolve({ errorCode: "host.channel.response-too-large", status: "failed" });
    return;
  }
  resolve({ payload, status: "response" });
};

const eventPayload = (
  event: NativeWebSocketEvent,
  expected: NativeWebSocketHostTransportConfig["responseKind"],
): Uint8Array | undefined => {
  if (event.kind === "binary" && event.data && expected !== "text") return event.data;
  if (event.kind === "text" && event.text !== null && expected !== "binary") {
    return new TextEncoder().encode(event.text);
  }
  return undefined;
};

const failure = (status: "notSent" | "unknown", errorCode: string): HostChannelResult => ({
  errorCode,
  status,
});

const connectErrorCode = (error: unknown): string =>
  error instanceof HostChannelTimeoutError ? error.code : "host.channel.connect-failed";

const dispatchErrorCode = (error: unknown): string =>
  error instanceof HostChannelTimeoutError ? error.code : "host.channel.write-failed";

const validateConfig = (config: NativeWebSocketHostTransportConfig): void => {
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    throw new Error("host.channel.websocket-config-invalid");
  }
  if (
    !config.id ||
    !["ws:", "wss:"].includes(url.protocol) ||
    config.connectTimeoutMs <= 0 ||
    config.sendTimeoutMs <= 0 ||
    config.responseTimeoutMs <= 0 ||
    config.maxMessageBytes <= 0
  ) {
    throw new Error("host.channel.websocket-config-invalid");
  }
  if (config.tls === "required" && url.protocol !== "wss:") {
    throw new Error("host.channel.websocket-tls-required");
  }
};
