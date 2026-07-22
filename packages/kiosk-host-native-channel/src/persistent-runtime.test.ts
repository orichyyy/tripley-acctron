import { HostWireTransportRegistry } from "@tripley-kit/web-container-kiosk-host-integration";
import { describe, expect, it, vi } from "vitest";

import { createAsciiLengthPrefixFrameCodec } from "./framing";
import { HostInboundMessageRegistry } from "./inbound-registry";
import { registerPersistentNativeHostSessions } from "./persistent-runtime";

describe("persistent native host runtime", () => {
  it("fails before registration when native TCP is unavailable", () => {
    expect(() =>
      registerPersistentNativeHostSessions({
        native: {},
        registry: new HostWireTransportRegistry(),
        tcp: [config()],
      }),
    ).toThrow("host.session.native-tcp-capability-required");
  });

  it("registers and starts persistent sessions through the host transport boundary", async () => {
    const connect = vi.fn(async () => "socket-1");
    const registry = new HostWireTransportRegistry();
    const runtime = registerPersistentNativeHostSessions({
      native: {
        tcp: {
          close: vi.fn(async () => undefined),
          connect,
          end: vi.fn(async () => undefined),
          onEvent: () => ({ unsubscribe: vi.fn() }),
          write: vi.fn(async () => undefined),
        },
      },
      registry,
      tcp: [config()],
    });

    expect(registry.require("native.tcp.persistent")).toBe(runtime.sessions[0]);
    await runtime.start();
    expect(connect).toHaveBeenCalledOnce();
    await runtime.dispose();
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
