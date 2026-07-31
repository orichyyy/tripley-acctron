import { describe, expect, it, vi } from "vitest";

import { XfsDeviceModuleAdapterRegistry } from "./module-adapters";
import { createXfsDeviceService } from "./service";
import type { XfsRuntimeClientLike } from "./types";

describe("XfsDeviceService disposal", () => {
  it("closes an owned session without acquiring a command lease", async () => {
    const acquireNext = vi.fn(async () => {
      throw new Error("logical service command lease is active or stale");
    });
    const close = vi.fn(async () => ({}));
    const client = {
      bcr: {},
      commandLeases: {
        acquire: vi.fn(),
        acquireNext,
        getHostEpoch: vi.fn(async () => "epoch-1"),
        release: vi.fn(),
        status: vi.fn(),
        transition: vi.fn(),
      },
      connect: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
      idc: {},
      manager: {
        close,
        open: vi.fn(async () => ({
          native: { hResult: 0 },
          session: { id: "cash-dispenser-session" },
        })),
        startup: vi.fn(async () => ({ hResult: 0 })),
      },
      pin: {},
    } as unknown as XfsRuntimeClientLike;
    const adapters = new XfsDeviceModuleAdapterRegistry().register({
      create: async ({ config }) => ({
        descriptor: {
          capabilities: config.capabilities,
          id: config.deviceId,
          type: "cashDispenser",
        },
        healthCheck: {
          check: async () => ({ id: config.deviceId, status: "healthy" }),
          id: config.deviceId,
        },
        port: {},
      }),
      module: "test-cdm",
      requiredModule: "cdm",
    });
    const service = createXfsDeviceService({
      appId: "disposal-test",
      logicalServices: [{
        capabilities: ["cash.dispense"],
        deviceId: "cashDispenser",
        logicalName: "CDM",
        module: "test-cdm",
        protectionPolicyProfileId: "bsp-cash",
        resourceGroup: "cash-transport",
      }],
      url: "ws://127.0.0.1:39010",
    }, {
      client,
      moduleAdapters: adapters,
    });

    await service.connect();
    await service.dispose();

    expect(close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith({
      sessionId: "cash-dispenser-session",
    });
    expect(acquireNext).not.toHaveBeenCalled();
    expect(client.dispose).toHaveBeenCalledOnce();
  });
});
