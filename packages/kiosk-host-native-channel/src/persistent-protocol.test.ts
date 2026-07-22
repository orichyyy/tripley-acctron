import { describe, expect, it, vi } from "vitest";

import type { NativeTcpEvent } from "./contracts";
import { createAsciiLengthPrefixFrameCodec } from "./framing";
import { HostInboundMessageRegistry } from "./inbound-registry";
import { PersistentNativeTcpHostSession } from "./persistent-session";

describe("persistent host protocol boundary", () => {
  it("contains a project frame-router failure and marks pending delivery unknown", async () => {
    let handler: ((event: NativeTcpEvent) => void) | undefined;
    const close = vi.fn(async () => undefined);
    const session = new PersistentNativeTcpHostSession(
      {
        close,
        connect: vi.fn(async () => "socket-1"),
        end: vi.fn(async () => undefined),
        onEvent: (next) => {
          handler = next;
          return { unsubscribe: vi.fn() };
        },
        write: vi.fn(async (socketId: string) => {
          handler?.(dataEvent(socketId, frame("BROKEN")));
        }),
      },
      config(),
    );

    await session.start();
    await expect(session.exchange(request())).resolves.toEqual({
      errorCode: "host.session.protocol-error",
      status: "unknown",
    });
    expect(close).toHaveBeenCalledWith("socket-1");
    await session.dispose();
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
  routeFrame: () => {
    throw new Error("project decoder failed");
  },
  security: { mode: "plain" as const },
  writeTimeoutMs: 100,
});

const request = () => ({
  channel: "host",
  idempotencyKey: "request-1",
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
