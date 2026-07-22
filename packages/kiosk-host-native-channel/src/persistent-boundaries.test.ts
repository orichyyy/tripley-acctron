import { describe, expect, it, vi } from "vitest";

import type { NativeTcpEvent } from "./contracts";
import { createAsciiLengthPrefixFrameCodec } from "./framing";
import { HostInboundMessageRegistry } from "./inbound-registry";
import { PersistentNativeTcpHostSession } from "./persistent-session";

describe("persistent host session boundaries", () => {
  it("reassembles one response split across native data events", async () => {
    let handler: ((event: NativeTcpEvent) => void) | undefined;
    const session = new PersistentNativeTcpHostSession(
      native(
        (socketId) => {
          const response = frame("APPROVED");
          handler?.(dataEvent(socketId, response.slice(0, 3)));
          handler?.(dataEvent(socketId, response.slice(3)));
        },
        (next) => {
          handler = next;
        },
      ),
      config(),
    );

    await session.start();
    await expect(session.exchange(request())).resolves.toMatchObject({
      payload: text("APPROVED"),
      status: "response",
    });
    await session.dispose();
  });

  it("marks an active response wait unknown and releases resources on dispose", async () => {
    const close = vi.fn(async () => undefined);
    const unsubscribe = vi.fn();
    const write = vi.fn(async () => undefined);
    const session = new PersistentNativeTcpHostSession(
      {
        ...native(
          () => undefined,
          () => undefined,
        ),
        close,
        onEvent: () => ({ unsubscribe }),
        write,
      },
      config(),
    );

    await session.start();
    const exchange = session.exchange(request());
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    await session.dispose();

    await expect(exchange).resolves.toEqual({
      errorCode: "host.session.disposed-after-dispatch",
      status: "unknown",
    });
    expect(close).toHaveBeenCalledWith("socket-1");
    expect(unsubscribe).toHaveBeenCalledOnce();
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

const native = (
  onWrite: (socketId: string) => void,
  setHandler: (handler: (event: NativeTcpEvent) => void) => void,
) => ({
  close: vi.fn(async () => undefined),
  connect: vi.fn(async () => "socket-1"),
  end: vi.fn(async () => undefined),
  onEvent: (handler: (event: NativeTcpEvent) => void) => {
    setHandler(handler);
    return { unsubscribe: vi.fn() };
  },
  write: vi.fn(async (socketId: string) => onWrite(socketId)),
});

const request = () => ({
  channel: "host",
  idempotencyKey: "request-1",
  payload: text("AEX"),
  timeoutMs: 100,
});

const text = (value: string) => new TextEncoder().encode(value);
const frame = (body: string) => codec.encode(text(body));

const dataEvent = (id: string, data: Uint8Array): NativeTcpEvent => ({
  data,
  id,
  kind: "data",
  message: null,
  parentId: null,
});
