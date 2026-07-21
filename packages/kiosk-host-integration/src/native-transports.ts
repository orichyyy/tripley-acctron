import type {
  FrameworkTcpPort,
  FrameworkWebSocketPort,
} from "@tripley-kit/web-container-native-adapter";

import type {
  HostWireExchangeRequest,
  HostWireExchangeResult,
  HostWireTransportAdapter,
} from "./contracts";

export interface NativeHostTransportConfig {
  readonly id: string;
  readonly method: string;
  readonly endpoint: Readonly<Record<string, string | number | boolean>>;
  classifyError?(error: unknown): "notSent" | "unknown";
}

interface NativeHostExchangeResult {
  readonly status: "response" | "notSent" | "unknown";
  readonly responseId?: string;
  readonly payload?: Uint8Array;
  readonly errorCode?: string;
}

interface NativeCallPort {
  call<T>(method: string, ...args: unknown[]): Promise<T>;
}

class NativeHostWireTransport implements HostWireTransportAdapter {
  public readonly id: string;

  public constructor(
    private readonly port: NativeCallPort,
    private readonly config: NativeHostTransportConfig,
  ) {
    this.id = config.id;
  }

  public async exchange(request: HostWireExchangeRequest): Promise<HostWireExchangeResult> {
    try {
      const result = await this.port.call<NativeHostExchangeResult>(this.config.method, {
        ...request,
        endpoint: this.config.endpoint,
      });
      if (result.status === "response" && result.responseId && result.payload) {
        return { payload: result.payload, responseId: result.responseId, status: "response" };
      }
      if (result.status === "notSent") {
        return { errorCode: result.errorCode ?? "host.native.not-sent", status: "notSent" };
      }
      return { errorCode: result.errorCode ?? "host.native.outcome-unknown", status: "unknown" };
    } catch (error) {
      const status = this.config.classifyError?.(error) ?? "unknown";
      return { errorCode: "host.native.call-failed", status };
    }
  }
}

export class NativeTcpHostTransportAdapter extends NativeHostWireTransport {
  // biome-ignore lint/complexity/noUselessConstructor: Keeps the public adapter contract typed as TCP.
  public constructor(port: FrameworkTcpPort, config: NativeHostTransportConfig) {
    super(port, config);
  }
}

export class NativeWebSocketHostTransportAdapter extends NativeHostWireTransport {
  // biome-ignore lint/complexity/noUselessConstructor: Keeps the public adapter contract typed as WebSocket.
  public constructor(port: FrameworkWebSocketPort, config: NativeHostTransportConfig) {
    super(port, config);
  }
}
