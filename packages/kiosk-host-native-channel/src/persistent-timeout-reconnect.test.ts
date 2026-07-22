import { describe, expect, it, vi } from "vitest";

import { createAsciiLengthPrefixFrameCodec } from "./framing";
import { HostInboundMessageRegistry } from "./inbound-registry";
import { PersistentNativeTcpHostSession } from "./persistent-session";

describe("persistent response-timeout recovery", () => {
  it("retires the ambiguous connection before accepting another exchange", async () => {
    vi.useFakeTimers();
    try {
      const connect = vi
        .fn<() => Promise<string>>()
        .mockResolvedValueOnce("socket-1")
        .mockResolvedValueOnce("socket-2");
      const close = vi.fn(async () => undefined);
      const session = new PersistentNativeTcpHostSession(
        {
          close,
          connect,
          end: vi.fn(async () => undefined),
          onEvent: () => ({ unsubscribe: vi.fn() }),
          write: vi.fn(async () => undefined),
        },
        config(),
      );

      await session.start();
      const exchange = session.exchange(request());
      const result = expect(exchange).resolves.toEqual({
        errorCode: "host.session.response-timeout",
        status: "unknown",
      });
      await vi.advanceTimersByTimeAsync(101);
      await result;
      expect(close).toHaveBeenCalledWith("socket-1");

      await vi.advanceTimersByTimeAsync(10);
      expect(connect).toHaveBeenCalledTimes(2);
      expect(session.generation).toBe(2);
      await session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

const config = () => ({
  connectTimeoutMs: 100,
  frame: createAsciiLengthPrefixFrameCodec({
    lengthIncludesPrefix: false,
    maxFrameBytes: 64,
    prefixBytes: 4,
  }),
  host: "127.0.0.1",
  id: "native.tcp.persistent",
  inbound: new HostInboundMessageRegistry(),
  port: 12008,
  reconnect: { initialDelayMs: 10, maxDelayMs: 100, multiplier: 2 },
  responseTimeoutMs: 100,
  routeFrame: () => ({ kind: "response" as const }),
  security: { mode: "plain" as const },
  writeTimeoutMs: 100,
});

const request = () => ({
  channel: "host",
  idempotencyKey: "request-1",
  payload: new TextEncoder().encode("AEX"),
  timeoutMs: 100,
});
