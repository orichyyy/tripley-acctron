import { HostWireTransportRegistry } from "@tripley-kit/web-container-kiosk-host-integration";
import { describe, expect, it, vi } from "vitest";

import { createExampleHostChannels } from "./host-channels";

describe("example native host channels", () => {
  it("contributes the project TCP channel without changing framework core", () => {
    const registry = new HostWireTransportRegistry();
    const runtime = createExampleHostChannels(
      {
        tcp: {
          close: vi.fn(async () => undefined),
          connect: vi.fn(async () => "socket-1"),
          end: vi.fn(async () => undefined),
          onEvent: () => ({ unsubscribe: vi.fn() }),
          write: vi.fn(async () => undefined),
        },
      },
      registry,
      { host: "127.0.0.1", port: 7001 },
    );
    expect(registry.require("native.tcp.primary")).toBe(runtime.adapters[0]);
  });
});
