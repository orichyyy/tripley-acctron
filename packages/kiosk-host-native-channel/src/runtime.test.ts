import { HostWireTransportRegistry } from "@tripley-kit/web-container-kiosk-host-integration";
import { describe, expect, it, vi } from "vitest";

import { createAsciiLengthPrefixFrameCodec } from "./framing";
import { registerNativeHostChannels } from "./runtime";

describe("native host channel runtime", () => {
  it("fails before registration when a configured native capability is absent", () => {
    expect(() =>
      registerNativeHostChannels({
        native: {},
        registry: new HostWireTransportRegistry(),
        tcp: [tcpConfig()],
      }),
    ).toThrow("host.channel.native-tcp-capability-required");
  });

  it("registers native adapters through the open transport registry", () => {
    const registry = new HostWireTransportRegistry();
    const runtime = registerNativeHostChannels({
      native: { tcp: tcp() },
      registry,
      tcp: [tcpConfig()],
    });
    expect(registry.require("native.tcp.primary")).toBe(runtime.adapters[0]);
  });
});

const tcpConfig = () => ({
  connectTimeoutMs: 100,
  frame: createAsciiLengthPrefixFrameCodec({
    lengthIncludesPrefix: false,
    maxFrameBytes: 64,
    prefixBytes: 4,
  }),
  host: "127.0.0.1",
  id: "native.tcp.primary",
  port: 7001,
  responseTimeoutMs: 100,
  security: { mode: "plain" as const },
  writeTimeoutMs: 100,
});

const tcp = () => ({
  close: vi.fn(async () => undefined),
  connect: vi.fn(async () => "socket-1"),
  end: vi.fn(async () => undefined),
  onEvent: () => ({ unsubscribe: vi.fn() }),
  write: vi.fn(async () => undefined),
});
