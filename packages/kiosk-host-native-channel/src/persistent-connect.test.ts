import { describe, expect, it, vi } from "vitest";

import { createAsciiLengthPrefixFrameCodec } from "./framing";
import { HostInboundMessageRegistry } from "./inbound-registry";
import { PersistentNativeTcpHostSession } from "./persistent-session";

describe("persistent host connection lifecycle", () => {
  it("closes a native socket that arrives after connect timeout", async () => {
    vi.useFakeTimers();
    try {
      let resolveConnect: (socketId: string) => void = () => undefined;
      const connect = new Promise<string>((resolve) => {
        resolveConnect = resolve;
      });
      const close = vi.fn(async () => undefined);
      const session = new PersistentNativeTcpHostSession(
        {
          close,
          connect: vi.fn(() => connect),
          end: vi.fn(async () => undefined),
          onEvent: () => ({ unsubscribe: vi.fn() }),
          write: vi.fn(async () => undefined),
        },
        config(),
      );

      const start = session.start();
      const rejected = expect(start).rejects.toThrow("host.session.connect-timeout");
      await vi.advanceTimersByTimeAsync(101);
      await rejected;
      resolveConnect("late-socket");
      await vi.waitFor(() => expect(close).toHaveBeenCalledWith("late-socket"));
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
