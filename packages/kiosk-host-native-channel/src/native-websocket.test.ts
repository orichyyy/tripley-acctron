import { describe, expect, it, vi } from "vitest";

import type { NativeWebSocketEvent } from "./contracts";
import { NativeWebSocketHostTransportAdapter } from "./native-websocket";

describe("native WebSocket host transport", () => {
  it("exchanges one binary host message and releases native resources", async () => {
    let handler: ((event: NativeWebSocketEvent) => void) | undefined;
    const close = vi.fn(async () => undefined);
    const unsubscribe = vi.fn();
    const sendBinary = vi.fn(async (socketId: string) => {
      handler?.({
        data: new TextEncoder().encode("APPROVED"),
        id: socketId,
        kind: "binary",
        message: null,
        parentId: null,
        text: null,
      });
    });
    const adapter = new NativeWebSocketHostTransportAdapter(
      {
        close,
        connect: vi.fn(async () => "socket-1"),
        onEvent: (next) => {
          handler = next;
          return { unsubscribe };
        },
        sendBinary,
        sendText: vi.fn(async () => undefined),
      },
      config(),
    );

    await expect(adapter.exchange(request())).resolves.toMatchObject({
      payload: new TextEncoder().encode("APPROVED"),
      responseId: "request-1:response",
      status: "response",
    });
    expect(sendBinary).toHaveBeenCalledWith("socket-1", request().payload);
    expect(close).toHaveBeenCalledWith("socket-1");
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("classifies send failure as unknown", async () => {
    const adapter = new NativeWebSocketHostTransportAdapter(
      {
        close: vi.fn(async () => undefined),
        connect: vi.fn(async () => "socket-1"),
        onEvent: () => ({ unsubscribe: vi.fn() }),
        sendBinary: vi.fn(async () => {
          throw new Error("lost");
        }),
        sendText: vi.fn(async () => undefined),
      },
      config(),
    );
    await expect(adapter.exchange(request())).resolves.toEqual({
      errorCode: "host.channel.write-failed",
      status: "unknown",
    });
  });

  it("fails fast when TLS policy is paired with a plain ws URL", () => {
    expect(
      () =>
        new NativeWebSocketHostTransportAdapter(
          {
            close: vi.fn(async () => undefined),
            connect: vi.fn(async () => "socket-1"),
            onEvent: () => ({ unsubscribe: vi.fn() }),
            sendBinary: vi.fn(async () => undefined),
            sendText: vi.fn(async () => undefined),
          },
          { ...config(), url: "ws://host.example/messages" },
        ),
    ).toThrow("host.channel.websocket-tls-required");
  });
});

const config = () => ({
  connectTimeoutMs: 100,
  id: "native.websocket.host",
  maxMessageBytes: 64,
  requestKind: "binary" as const,
  responseKind: "binary" as const,
  responseTimeoutMs: 100,
  sendTimeoutMs: 100,
  tls: "required" as const,
  url: "wss://host.example/messages",
});

const request = () => ({
  channel: "primary",
  idempotencyKey: "request-1",
  payload: new TextEncoder().encode("REQUEST"),
  timeoutMs: 100,
});
