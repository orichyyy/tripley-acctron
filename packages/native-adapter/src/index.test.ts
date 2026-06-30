import { describe, expect, it } from "vitest";
import { NativeExtensionRegistry, TripleyNativeAdapter } from "./index";
import type { NativeExtensionAdapter } from "./index";

const createNative = (capabilities: readonly string[] = []) => ({
  archive: {},
  connect: async () => undefined,
  dispose: async () => undefined,
  fs: {
    readText: async (path: string) => `read:${path}`,
  },
  runtime: {
    getInfo: async () => ({ name: "test-native" }),
    listCapabilities: async () => [...capabilities],
  },
  sqlite: {},
  system: {},
  tcp: {},
  websocket: {},
});

describe("TripleyNativeAdapter", () => {
  it("wraps current native services without exposing the raw SDK", async () => {
    const adapter = new TripleyNativeAdapter(createNative(["fs"]));

    await expect(adapter.fs.call("readText", "/tmp/a.txt")).resolves.toBe("read:/tmp/a.txt");
  });

  it("fails fast for missing required services and methods", async () => {
    const adapter = new TripleyNativeAdapter(createNative(["runtime", "sqlite"]));

    await expect(
      adapter.requireCapabilities(["runtime", "window.openWindow", "sqlite.transaction"]),
    ).rejects.toMatchObject({
      code: "native.capability.missing",
      severity: "fatal",
    });
  });

  it("uses native extension capabilities as temporary bridges", async () => {
    const extensions = new NativeExtensionRegistry();
    extensions.register({
      capabilities: ["device.pinpad"],
      call: async <_TRequest, TResponse>() => "ok" as TResponse,
      id: "pinpad-rpc",
    });

    const adapter = new TripleyNativeAdapter(createNative(["runtime"]), { extensions });

    await expect(adapter.requireCapabilities(["device.pinpad"])).resolves.toBeUndefined();
    await expect(extensions.require("pinpad-rpc").call("status", {})).resolves.toBe("ok");
  });

  it("rejects invalid native SDK objects at the boundary", () => {
    expect(() => new TripleyNativeAdapter({ runtime: {} })).toThrow("Native SDK must provide");
  });
});

describe("NativeExtensionRegistry", () => {
  it("rejects duplicate extension ids", () => {
    const extension: NativeExtensionAdapter = {
      capabilities: ["device.example"],
      call: async <_TRequest, TResponse>() => undefined as TResponse,
      id: "example",
    };
    const registry = new NativeExtensionRegistry();
    registry.register(extension);

    expect(() => registry.register(extension)).toThrow("already registered");
  });
});
