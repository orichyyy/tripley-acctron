import type { Disposable } from "./bus";

export interface HostTransport {
  connect(): Promise<void>;
  send(data: Uint8Array | string): Promise<void>;
  onData(handler: (data: Uint8Array | string) => void): Disposable;
  close(): Promise<void>;
}

export interface HostCodec<RawMessage> {
  encode(message: RawMessage): Uint8Array | string;
  decode(data: Uint8Array | string): RawMessage;
}

export interface HostMessageMapper<RawMessage> {
  toCanonical(raw: RawMessage): CanonicalHostMessage;
  fromCanonical(message: CanonicalHostMessage): RawMessage;
}

export type HostCommand =
  | {
      type: "suspendService";
      mode: "immediate" | "afterCurrentTransaction";
      reason?: string;
    }
  | {
      type: "resumeService";
    }
  | {
      type: "enterMaintenance";
      reason?: string;
    }
  | {
      type: "exitMaintenance";
    };

export type CanonicalHostMessage =
  | {
      type: "command";
      command: HostCommand;
      traceId: string;
    }
  | {
      type: "request";
      requestId: string;
      messageType: string;
      traceId: string;
      body: unknown;
    }
  | {
      type: "response";
      requestId: string;
      status: "approved" | "declined" | "error";
      body: unknown;
    }
  | {
      type: "notification";
      name: string;
      body: unknown;
    };

export interface HostRequest<TBody = unknown> {
  messageType: string;
  body: TBody;
}

export interface HostResponse<TBody = unknown> {
  requestId: string;
  status: "approved" | "declined" | "error";
  body: TBody;
}

export interface HostSendOptions {
  timeoutMs?: number;
  traceId?: string;
  signal?: AbortSignal;
}

export type HostCommandHandler = (command: HostCommand, traceId: string) => void | Promise<void>;

export interface HostGateway {
  send<TReq = unknown, TRes = unknown>(
    messageType: string,
    body: TReq,
    options?: HostSendOptions,
  ): Promise<HostResponse<TRes>>;
  request<TReq = unknown, TRes = unknown>(
    request: HostRequest<TReq>,
    options?: HostSendOptions,
  ): Promise<HostResponse<TRes>>;
}
