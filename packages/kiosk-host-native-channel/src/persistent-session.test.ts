import { describe, expect, it, vi } from "vitest";

import type { NativeTcpEvent } from "./contracts";
import { createAsciiLengthPrefixFrameCodec } from "./framing";
import { HostInboundMessageRegistry } from "./inbound-registry";
import { PersistentNativeTcpHostSession } from "./persistent-session";

describe("persistent native TCP host session", () => {
  it("reuses one connection for sequential host exchanges", async () => {
    let handler: ((event: NativeTcpEvent) => void) | undefined;
    const connect = vi.fn(async () => "socket-1");
    const close = vi.fn(async () => undefined);
    const write = vi.fn(async (socketId: string) => {
      handler?.(dataEvent(socketId, frame("OK")));
    });
    const session = new PersistentNativeTcpHostSession(
      {
        close,
        connect,
        end: vi.fn(async () => undefined),
        onEvent: (next) => {
          handler = next;
          return { unsubscribe: vi.fn() };
        },
        write,
      },
      config(),
    );

    await session.start();
    await expect(session.exchange(request("request-1"))).resolves.toMatchObject({
      payload: new TextEncoder().encode("OK"),
      responseId: "request-1:response",
      status: "response",
    });
    await expect(session.exchange(request("request-2"))).resolves.toMatchObject({
      responseId: "request-2:response",
      status: "response",
    });

    expect(connect).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledTimes(2);
    expect(close).not.toHaveBeenCalled();
    await session.dispose();
    expect(close).toHaveBeenCalledOnce();
  });
});

const codec = createAsciiLengthPrefixFrameCodec({
  lengthIncludesPrefix: false,
  maxFrameBytes: 64,
  prefixBytes: 4,
});

const config = () => ({
  connectTimeoutMs: 100,
  frame: codec,
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

const request = (idempotencyKey: string) => ({
  channel: "host",
  idempotencyKey,
  payload: new TextEncoder().encode("AEX"),
  timeoutMs: 100,
});

const frame = (body: string) => codec.encode(new TextEncoder().encode(body));

const dataEvent = (id: string, data: Uint8Array): NativeTcpEvent => ({
  data,
  id,
  kind: "data",
  message: null,
  parentId: null,
});
