import { describe, expect, it, vi } from "vitest";

import type { NativeTcpEvent } from "./contracts";
import { createAsciiLengthPrefixFrameCodec } from "./framing";
import { HostInboundMessageRegistry } from "./inbound-registry";
import { PersistentNativeTcpHostSession } from "./persistent-session";

describe("persistent host duplex dispatch", () => {
  it("handles a coalesced inbound request before the pending host response", async () => {
    let handler: ((event: NativeTcpEvent) => void) | undefined;
    const inboundHandler = vi.fn(async (_message, context) => {
      await context.respond(text("ACK"));
    });
    const inbound = new HostInboundMessageRegistry().register({
      handle: inboundHandler,
      id: "bsp.command",
      type: "CMD",
    });
    const write = vi.fn(async (socketId: string, _payload: Uint8Array) => {
      if (write.mock.calls.length !== 1) return;
      handler?.(dataEvent(socketId, concat(frame("CMD"), frame("OK"))));
    });
    const session = new PersistentNativeTcpHostSession(
      {
        close: vi.fn(async () => undefined),
        connect: vi.fn(async () => "socket-1"),
        end: vi.fn(async () => undefined),
        onEvent: (next) => {
          handler = next;
          return { unsubscribe: vi.fn() };
        },
        write,
      },
      config(inbound),
    );

    await session.start();
    await expect(session.exchange(request())).resolves.toMatchObject({
      payload: text("OK"),
      status: "response",
    });
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));

    expect(inboundHandler).toHaveBeenCalledOnce();
    expect(inboundHandler.mock.calls[0]?.[0]).toMatchObject({
      generation: 1,
      payload: text("CMD"),
      type: "CMD",
    });
    expect(write.mock.calls[1]?.[0]).toBe("socket-1");
    expect(write.mock.calls[1]?.[1]).toEqual(frame("ACK"));
    await session.dispose();
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
  routeFrame: ({ payload }: { payload: Uint8Array }) =>
    new TextDecoder().decode(payload) === "CMD"
      ? ({ kind: "inbound", type: "CMD" } as const)
      : ({ kind: "response" } as const),
  security: { mode: "plain" as const },
  writeTimeoutMs: 100,
});

const request = () => ({
  channel: "host",
  idempotencyKey: "request-1",
  payload: text("AEX"),
  timeoutMs: 100,
});

const text = (value: string) => new TextEncoder().encode(value);
const frame = (body: string) => codec.encode(text(body));

const concat = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

const dataEvent = (id: string, data: Uint8Array): NativeTcpEvent => ({
  data,
  id,
  kind: "data",
  message: null,
  parentId: null,
});
