import { describe, expect, it, vi } from "vitest";

import type { NativeTcpEvent } from "./contracts";
import { createAsciiLengthPrefixFrameCodec } from "./framing";
import { HostInboundMessageRegistry } from "./inbound-registry";
import type { HostInboundMessageContext } from "./persistent-contracts";
import { PersistentNativeTcpHostSession } from "./persistent-session";

describe("persistent inbound reply fencing", () => {
  it("rejects a reply after its receiving generation has disconnected", async () => {
    vi.useFakeTimers();
    try {
      let nativeHandler: ((event: NativeTcpEvent) => void) | undefined;
      let inboundContext: HostInboundMessageContext | undefined;
      const inbound = new HostInboundMessageRegistry().register({
        handle: (_message, context) => {
          inboundContext = context;
        },
        id: "bsp.command",
        type: "CMD",
      });
      const connect = vi
        .fn<() => Promise<string>>()
        .mockResolvedValueOnce("socket-1")
        .mockResolvedValueOnce("socket-2");
      const write = vi.fn(async () => undefined);
      const session = new PersistentNativeTcpHostSession(
        {
          close: vi.fn(async () => undefined),
          connect,
          end: vi.fn(async () => undefined),
          onEvent: (handler) => {
            nativeHandler = handler;
            return { unsubscribe: vi.fn() };
          },
          write,
        },
        config(inbound),
      );

      await session.start();
      nativeHandler?.(dataEvent("socket-1", frame("CMD")));
      await vi.waitFor(() => expect(inboundContext).toBeDefined());
      nativeHandler?.(socketEvent("socket-1", "close"));
      await vi.advanceTimersByTimeAsync(10);
      expect(session.generation).toBe(2);

      await expect(inboundContext?.respond(text("ACK"))).resolves.toEqual({
        errorCode: "host.session.inbound-reply-stale",
        status: "notSent",
      });
      expect(write).not.toHaveBeenCalled();
      await session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

const codec = createAsciiLengthPrefixFrameCodec({
  lengthIncludesPrefix: false,
  maxFrameBytes: 64,
  prefixBytes: 4,
});

const config = (inbound: HostInboundMessageRegistry) => ({
  connectTimeoutMs: 100,
  frame: codec,
  host: "127.0.0.1",
  id: "native.tcp.persistent",
  inbound,
  port: 12008,
  reconnect: { initialDelayMs: 10, maxDelayMs: 100, multiplier: 2 },
  responseTimeoutMs: 100,
  routeFrame: () => ({ kind: "inbound" as const, type: "CMD" }),
  security: { mode: "plain" as const },
  writeTimeoutMs: 100,
});

const text = (value: string) => new TextEncoder().encode(value);
const frame = (body: string) => codec.encode(text(body));

const socketEvent = (id: string, kind: "close" | "error"): NativeTcpEvent => ({
  data: null,
  id,
  kind,
  message: null,
  parentId: null,
});

const dataEvent = (id: string, data: Uint8Array): NativeTcpEvent => ({
  data,
  id,
  kind: "data",
  message: null,
  parentId: null,
});
