import { HostWireTransportRegistry } from "@tripley-kit/web-container-kiosk-host-integration";
import {
  HostInboundMessageRegistry,
  createAsciiLengthPrefixFrameCodec,
} from "@tripley-kit/web-container-kiosk-host-native-channel";
import { describe, expect, it, vi } from "vitest";

import { createExamplePersistentHostChannel } from "./persistent-host-channel";

describe("example persistent host channel contribution", () => {
  it("registers project-owned framing and routing without core changes", async () => {
    const registry = new HostWireTransportRegistry();
    const connect = vi.fn(async () => "socket-1");
    const runtime = createExamplePersistentHostChannel(
      {
        close: vi.fn(async () => undefined),
        connect,
        end: vi.fn(async () => undefined),
        onEvent: () => ({ unsubscribe: vi.fn() }),
        write: vi.fn(async () => undefined),
      },
      registry,
      {
        frame: createAsciiLengthPrefixFrameCodec({
          lengthIncludesPrefix: false,
          maxFrameBytes: 64,
          prefixBytes: 4,
        }),
        host: "127.0.0.1",
        inbound: new HostInboundMessageRegistry(),
        port: 12008,
        routeFrame: () => ({ kind: "response" }),
      },
    );

    expect(registry.require("native.tcp.persistent")).toBe(runtime.sessions[0]);
    await runtime.start();
    expect(connect).toHaveBeenCalledOnce();
    await runtime.dispose();
  });
});
