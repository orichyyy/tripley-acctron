import { describe, expect, it, vi } from "vitest";

import type { NativeTcpEvent } from "./contracts";
import { createAsciiLengthPrefixFrameCodec } from "./framing";
import { HostInboundMessageRegistry } from "./inbound-registry";
import type { PersistentHostSessionLifecycleEvent } from "./persistent-contracts";
import { PersistentNativeTcpHostSession } from "./persistent-session";

describe("persistent host reconnect", () => {
  it("marks an interrupted exchange unknown and fences stale events after reconnect", async () => {
    vi.useFakeTimers();
    try {
      let handler: ((event: NativeTcpEvent) => void) | undefined;
      const connect = vi
        .fn<() => Promise<string>>()
        .mockResolvedValueOnce("socket-1")
        .mockResolvedValueOnce("socket-2");
      const routeFrame = vi.fn(() => ({ kind: "response" as const }));
      const write = vi.fn(async (socketId: string) => {
        if (socketId === "socket-1") {
          handler?.(socketEvent(socketId, "close"));
          return;
        }
        handler?.(dataEvent(socketId, frame("OK")));
      });
      const session = new PersistentNativeTcpHostSession(
        {
          close: vi.fn(async () => undefined),
          connect,
          end: vi.fn(async () => undefined),
          onEvent: (next) => {
            handler = next;
            return { unsubscribe: vi.fn() };
          },
          write,
        },
        config(routeFrame),
      );
      const events: PersistentHostSessionLifecycleEvent[] = [];
      session.onLifecycle((event) => events.push(event));

      await session.start();
      await expect(session.exchange(request("request-1"))).resolves.toEqual({
        errorCode: "host.session.remote-close",
        status: "unknown",
      });

      await vi.advanceTimersByTimeAsync(10);
      expect(connect).toHaveBeenCalledTimes(2);
      expect(session.generation).toBe(2);
      expect(session.state).toBe("connected");

      handler?.(dataEvent("socket-1", frame("LATE")));
      expect(routeFrame).not.toHaveBeenCalled();
      await expect(session.exchange(request("request-2"))).resolves.toMatchObject({
        payload: text("OK"),
        status: "response",
      });
      expect(JSON.stringify(events)).not.toContain("AEX");
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ generation: 1, type: "disconnected" }),
          expect.objectContaining({ delayMs: 10, type: "reconnect-scheduled" }),
          expect.objectContaining({ generation: 2, type: "connected" }),
        ]),
      );
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

const config = (routeFrame: (input: unknown) => { kind: "response" }) => ({
  connectTimeoutMs: 100,
  frame: codec,
  host: "127.0.0.1",
  id: "native.tcp.persistent",
  inbound: new HostInboundMessageRegistry(),
  port: 12008,
  reconnect: { initialDelayMs: 10, maxDelayMs: 100, multiplier: 2 },
  responseTimeoutMs: 100,
  routeFrame,
  security: { mode: "plain" as const },
  writeTimeoutMs: 100,
});

const request = (idempotencyKey: string) => ({
  channel: "host",
  idempotencyKey,
  payload: text("AEX"),
  timeoutMs: 100,
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
