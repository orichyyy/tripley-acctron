import { describe, expect, it } from "vitest";

import type { NativePort } from "@tripley/web-container-native-adapter";
import { NativeExtensionRegistry } from "@tripley/web-container-native-adapter";

import type { NativeWindowBridge } from "./index";
import { NativeWindowManagerPort } from "./index";

describe("NativeWindowManagerPort", () => {
  it("fails fast when required window/display capabilities are missing", async () => {
    const native = createNativePort([]);
    const manager = new NativeWindowManagerPort(native, createBridge());

    await expect(manager.open({ path: "/customer", windowKey: "kiosk.customer" })).rejects.toThrow(
      "Missing required native capabilities",
    );
  });

  it("does not use a browser window.open fallback", async () => {
    const opened: string[] = [];
    const native = createNativePort(["window.open", "display.list"]);
    const manager = new NativeWindowManagerPort(native, {
      ...createBridge(),
      open: async (options) => {
        opened.push(options.windowKey);
        return { windowId: "native-1", windowKey: options.windowKey };
      },
    });

    await expect(manager.open({ path: "/customer", windowKey: "kiosk.customer" })).resolves.toEqual(
      {
        windowId: "native-1",
        windowKey: "kiosk.customer",
      },
    );
    expect(opened).toEqual(["kiosk.customer"]);
  });
});

const createNativePort = (capabilities: readonly string[]): NativePort => ({
  archive: { call: async <TResponse = unknown>() => undefined as TResponse },
  connect: async () => {},
  dispose: async () => {},
  extensions: new NativeExtensionRegistry(),
  fs: { call: async <TResponse = unknown>() => undefined as TResponse },
  getRuntimeInfo: async () => ({ name: "test" }),
  listCapabilities: async () => [...capabilities],
  requireCapabilities: async (required) => {
    const missing = required.filter((capability) => !capabilities.includes(capability));
    if (missing.length > 0) {
      throw new Error(`Missing required native capabilities: ${missing.join(", ")}`);
    }
  },
  sqlite: { call: async <TResponse = unknown>() => undefined as TResponse },
  system: { call: async <TResponse = unknown>() => undefined as TResponse },
  tcp: { call: async <TResponse = unknown>() => undefined as TResponse },
  websocket: { call: async <TResponse = unknown>() => undefined as TResponse },
});

const createBridge = (): NativeWindowBridge => ({
  broadcast: async () => {},
  close: async () => {},
  focus: async () => {},
  get: async () => null,
  getDisplay: async () => null,
  getPrimaryDisplay: async () => ({
    bounds: { height: 600, width: 800, x: 0, y: 0 },
    id: "display-1",
    index: 0,
    isPrimary: true,
  }),
  hide: async () => {},
  list: async () => [],
  listDisplays: async () => [],
  minimize: async () => {},
  moveToDisplay: async () => {},
  open: async (options) => ({ windowId: "native-1", windowKey: options.windowKey }),
  request: async <_TRequest = unknown, TResponse = unknown>() => undefined as TResponse,
  restore: async () => {},
  setAlwaysOnTop: async () => {},
  setBounds: async () => {},
  show: async () => {},
});
