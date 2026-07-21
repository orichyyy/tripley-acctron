import { describe, expect, it, vi } from "vitest";

import {
  NativeTcpHostTransportAdapter,
  NativeWebSocketHostTransportAdapter,
} from "./native-transports";

describe("native host transports", () => {
  it("uses the configured atomic TCP native method", async () => {
    const call = vi.fn(async () => ({
      payload: Uint8Array.from([1]),
      responseId: "r1",
      status: "response" as const,
    }));
    const adapter = new NativeTcpHostTransportAdapter({ call } as never, {
      endpoint: { host: "127.0.0.1", port: 9000 },
      id: "native.tcp",
      method: "host.exchange",
    });
    await expect(exchange(adapter)).resolves.toMatchObject({
      responseId: "r1",
      status: "response",
    });
    expect(call).toHaveBeenCalledWith(
      "host.exchange",
      expect.objectContaining({ idempotencyKey: "request-1" }),
    );
  });

  it("uses the configured atomic WebSocket native method", async () => {
    const call = vi.fn(async () => ({
      payload: Uint8Array.from([1]),
      responseId: "r1",
      status: "response" as const,
    }));
    const adapter = new NativeWebSocketHostTransportAdapter({ call } as never, {
      endpoint: { url: "wss://host.example" },
      id: "native.websocket",
      method: "host.exchange",
    });
    await expect(exchange(adapter)).resolves.toMatchObject({
      responseId: "r1",
      status: "response",
    });
  });

  it("defaults thrown native calls to unknown certainty", async () => {
    const adapter = new NativeTcpHostTransportAdapter(
      {
        call: vi.fn(async () => {
          throw new Error("lost");
        }),
      } as never,
      {
        endpoint: {},
        id: "native.tcp",
        method: "host.exchange",
      },
    );
    await expect(exchange(adapter)).resolves.toEqual({
      errorCode: "host.native.call-failed",
      status: "unknown",
    });
  });
});

const exchange = (adapter: NativeTcpHostTransportAdapter | NativeWebSocketHostTransportAdapter) =>
  adapter.exchange({
    channel: "primary",
    idempotencyKey: "request-1",
    payload: Uint8Array.from([0]),
    timeoutMs: 1_000,
  });
