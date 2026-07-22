import type {
  HostWireExchangeRequest,
  HostWireExchangeResult,
  HostWireTransportAdapter,
} from "@tripley-kit/web-container-kiosk-host-integration";

import type { HostFrameCodec } from "./framing";

export interface NativeEventSubscription {
  unsubscribe(): void;
}

export interface NativeTcpEvent {
  readonly kind: "connection" | "data" | "close" | "error";
  readonly id: string;
  readonly parentId: string | null;
  readonly data: Uint8Array | null;
  readonly message: string | null;
}

export interface NativeTcpApi {
  connect(host: string, port: number): Promise<string>;
  connectTls?(host: string, port: number, options: NativeTcpTlsOptions): Promise<string>;
  write(socketId: string, data: Uint8Array): Promise<void>;
  end(socketId: string): Promise<void>;
  close(socketId: string): Promise<void>;
  onEvent(handler: (event: NativeTcpEvent) => void): NativeEventSubscription;
}

export interface NativeTcpTlsOptions {
  readonly serverName?: string | undefined;
  readonly pinnedCertificateSha256?: string | undefined;
}

export type NativeTcpSecurity =
  | { readonly mode: "plain" }
  | ({ readonly mode: "tls" } & NativeTcpTlsOptions);

export interface NativeTcpHostTransportConfig {
  readonly id: string;
  readonly host: string;
  readonly port: number;
  readonly connectTimeoutMs: number;
  readonly writeTimeoutMs: number;
  readonly responseTimeoutMs: number;
  readonly frame: HostFrameCodec;
  readonly security: NativeTcpSecurity;
}

export interface NativeWebSocketEvent {
  readonly kind: "connection" | "text" | "binary" | "close" | "error";
  readonly id: string;
  readonly parentId: string | null;
  readonly data: Uint8Array | null;
  readonly text: string | null;
  readonly message: string | null;
}

export interface NativeWebSocketApi {
  connect(url: string): Promise<string>;
  sendText(socketId: string, text: string): Promise<void>;
  sendBinary(socketId: string, data: Uint8Array): Promise<void>;
  close(socketId: string): Promise<void>;
  onEvent(handler: (event: NativeWebSocketEvent) => void): NativeEventSubscription;
}

export interface NativeWebSocketHostTransportConfig {
  readonly id: string;
  readonly url: string;
  readonly connectTimeoutMs: number;
  readonly sendTimeoutMs: number;
  readonly responseTimeoutMs: number;
  readonly maxMessageBytes: number;
  readonly requestKind: "binary" | "text";
  readonly responseKind: "binary" | "text" | "either";
  readonly tls: "allowed" | "required";
}

export interface DisposableHostWireTransportAdapter extends HostWireTransportAdapter {
  dispose(): Promise<void>;
}

export type HostChannelRequest = HostWireExchangeRequest;
export type HostChannelResult = HostWireExchangeResult;
