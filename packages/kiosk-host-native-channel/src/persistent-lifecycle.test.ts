import { describe, expect, it, vi } from "vitest";

import type { NativeTcpEvent } from "./contracts";
import { createAsciiLengthPrefixFrameCodec } from "./framing";
import { HostInboundMessageRegistry } from "./inbound-registry";
import type { PersistentHostSessionLifecycleEvent } from "./persistent-contracts";
import { PersistentNativeTcpHostSession } from "./persistent-session";

describe("persistent host lifecycle", () => {
  it("reports an unhandled inbound type without exposing its payload", async () => {
    let nativeHandler: ((event: NativeTcpEvent) => void) | undefined;
    const session = new PersistentNativeTcpHostSession(
      {
        close: vi.fn(async () => undefined),
        connect: vi.fn(async () => "socket-1"),
        end: vi.fn(async () => undefined),
        onEvent: (handler) => {
          nativeHandler = handler;
          return { unsubscribe: vi.fn() };
        },
        write: vi.fn(async () => undefined),
      },
      config(),
    );
    const events: PersistentHostSessionLifecycleEvent[] = [];
    session.onLifecycle((event) => events.push(event));
    await session.start();

    nativeHandler?.(dataEvent("socket-1", frame("SECRET-CMD")));
    await vi.waitFor(() =>
      expect(events).toContainEqual(
        expect.objectContaining({ inboundType: "CMD", type: "inbound-unhandled" }),
      ),
    );

    expect(JSON.stringify(events)).not.toContain("SECRET-CMD");
    expect(events.every((event) => !("payload" in event))).toBe(true);
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
  routeFrame: () => ({ kind: "inbound" as const, type: "CMD" }),
  security: { mode: "plain" as const },
  writeTimeoutMs: 100,
});

const frame = (body: string) => codec.encode(new TextEncoder().encode(body));

const dataEvent = (id: string, data: Uint8Array): NativeTcpEvent => ({
  data,
  id,
  kind: "data",
  message: null,
  parentId: null,
});
