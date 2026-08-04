import {
  DeviceLockManager,
  DeviceRegistry,
  InputSourceRegistry,
} from "@tripley-kit/web-container-device-core";
import { describe, expect, it } from "vitest";

import { createXfsDeviceService } from "./service";
import { XfsDeviceModuleAdapterRegistry } from "./module-adapters";
import type { XfsRuntimeClientLike } from "./types";

describe("XfsDeviceService", () => {
  it("accepts a custom module adapter without changing service core", async () => {
    const adapters = new XfsDeviceModuleAdapterRegistry().register({
      module: "nfc",
      requiredModule: "idc",
      create: async ({ config }) => ({
        descriptor: {
          capabilities: config.capabilities,
          id: config.deviceId,
          type: "nfcReader",
        },
        healthCheck: {
          id: `xfs.${config.deviceId}.health`,
          check: async () => ({ id: `xfs.${config.deviceId}.health`, status: "healthy" }),
        },
        port: { plugin: "bank-nfc" },
      }),
    });
    const service = createXfsDeviceService({
      logicalServices: [{
        capabilities: ["nfc.read"],
        deviceId: "bankNfc",
        logicalName: "BANK_NFC_A",
        module: "nfc",
      }],
      url: "ws://127.0.0.1:39010",
    }, { client: createFakeXfsClient(), moduleAdapters: adapters });
    await service.connect();
    const devices = new DeviceRegistry();
    service.registerDevices(devices);

    expect(service.requiredModules()).toEqual(["manager", "idc"]);
    expect(devices.list()).toEqual([
      expect.objectContaining({ id: "bankNfc", type: "nfcReader" }),
    ]);
  });

  it("fails fast when a configured module has no adapter", () => {
    expect(() => createXfsDeviceService({
      logicalServices: [{
        capabilities: ["custom.read"],
        deviceId: "custom",
        logicalName: "CUSTOM",
        module: "missing-module",
      }],
      url: "ws://127.0.0.1:39010",
    }, {
      client: createFakeXfsClient(),
      moduleAdapters: new XfsDeviceModuleAdapterRegistry(),
    })).toThrow(/No XFS module adapter/);
  });
  it("infers required modules from configured services", () => {
    const service = createXfsDeviceService(config(), { client: createFakeXfsClient() });

    expect(service.requiredModules()).toEqual(["manager", "idc", "pin", "bcr"]);
  });

  it("registers configured devices without hard-coded logical service names", async () => {
    const service = createXfsDeviceService(config(), { client: createFakeXfsClient() });
    await service.connect();
    const devices = new DeviceRegistry();

    service.registerDevices(devices);

    expect(devices.list().map((device) => device.id)).toEqual([
      "customCard",
      "customPinpad",
      "customBarcode",
    ]);
    expect(devices.list().map((device) => device.type)).toEqual([
      "cardReader",
      "pinpad",
      "barcodeReader",
    ]);
  });

  it("reports healthy configured logical services", async () => {
    const service = createXfsDeviceService(config(), { client: createFakeXfsClient() });
    await service.connect();

    const results = await Promise.all(service.healthChecks().map((check) => check.check()));

    expect(results.map((result) => result.status)).toEqual(["healthy", "healthy", "healthy"]);
  });

  it("reports an offline device as unhealthy when its status query succeeds", async () => {
    const service = createXfsDeviceService(config(), {
      client: createFakeXfsClient({ idcFwDevice: 1 }),
    });
    await service.connect();

    const results = await Promise.all(service.healthChecks().map((check) => check.check()));

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "xfs.customCard.health",
          metadata: expect.objectContaining({ fwDevice: 1 }),
          status: "unhealthy",
        }),
      ]),
    );
  });

  it("registers card, pinpad, and barcode input sources", async () => {
    const service = createXfsDeviceService(config(), { client: createFakeXfsClient() });
    await service.connect();
    const devices = new DeviceRegistry();
    const inputSources = new InputSourceRegistry();

    service.registerDevices(devices);
    service.registerInputSources(inputSources);

    expect(inputSources.has("cardReader.card")).toBe(true);
    expect(inputSources.has("pinpad.data")).toBe(true);
    expect(inputSources.has("pinpad.pin")).toBe(true);
    expect(inputSources.has("barcodeReader.qr")).toBe(true);
  });

  it("returns safe summaries from input source adapters", async () => {
    const fake = createFakeXfsClient();
    const service = createXfsDeviceService(config(), { client: fake });
    await service.connect();
    const devices = new DeviceRegistry();
    const inputSources = new InputSourceRegistry();
    service.registerDevices(devices);
    service.registerInputSources(inputSources);
    const ctx = executionContext(devices);

    const cardSession = await inputSources.require("cardReader.card").start(ctx, {
      id: "card",
      kind: "cardReader.card",
      required: true,
    });
    const dataSession = await inputSources.require("pinpad.data").start(ctx, {
      id: "amount",
      kind: "pinpad.data",
      required: true,
    });
    const qrSession = await inputSources.require("barcodeReader.qr").start(ctx, {
      id: "qr",
      kind: "barcodeReader.qr",
      required: false,
    });

    await expect(cardSession.result).resolves.toMatchObject({
      safeSummary: { sourceKind: "cardReader.card" },
      source: { deviceId: "customCard", kind: "cardReader.card" },
    });
    await expect(dataSession.result).resolves.toMatchObject({
      safeSummary: { sourceKind: "pinpad.data" },
      value: "123",
    });
    const pinSession = await inputSources.require("pinpad.pin").start(ctx, {
      id: "pin",
      kind: "pinpad.pin",
      required: true,
      secure: true,
    });
    await expect(pinSession.result).resolves.toMatchObject({
      encryptedPinBlock: "010203",
      safeSummary: {
        hasEncryptedPinBlock: true,
        sourceKind: "pinpad.pin",
      },
    });
    await expect(qrSession.result).resolves.toMatchObject({
      safeSummary: { sourceKind: "barcodeReader.qr" },
      value: "qr-value",
    });
    expect(fake.pin.getPinblockCalls).toHaveLength(1);
    expect(fake.pin.getPinCalls).toHaveLength(1);
  });

  it("recovers a failed PIN command and allows the next PIN input", async () => {
    const fake = createFakeXfsClient({ pinGetHResults: [-48, 0] });
    const service = createXfsDeviceService(config(), { client: fake });
    await service.connect();
    const devices = new DeviceRegistry();
    service.registerDevices(devices);
    const pin = devices.require<import("./ports").XfsPinpadDevicePort>("customPinpad");

    await expect(pin.getPin({ customerData: "123456789012" })).rejects.toMatchObject({
      code: "xfs.command.failed",
    });
    await expect(pin.getPin({ customerData: "123456789012" })).resolves.toMatchObject({
      kind: "securePin",
    });

    expect(fake.manager.cancelCalls).toHaveLength(1);
    expect(fake.pin.resetCalls).toBe(1);
    expect(fake.pin.getPinCalls).toHaveLength(2);
  });

  it("projects PIN key events as safe digit-count feedback", async () => {
    const fake = createFakeXfsClient({
      pinEvents: [
        { data: { kind: "key", value: { completion: 6, digit: 0 } } },
        { data: { kind: "key", value: { completion: 6, digit: 0 } } },
        { data: { kind: "key", value: { completion: 8, digit: 0 } } },
        { data: { kind: "key", value: { completion: 6, digit: 0 } } },
        { data: { kind: "key", value: { completion: 7, digit: 0 } } },
        { data: { kind: "key", value: { completion: 6, digit: 0 } } },
        { data: { kind: "key", value: { completion: 1, digit: 0 } } },
      ],
    });
    const service = createXfsDeviceService(config(), { client: fake });
    await service.connect();
    const devices = new DeviceRegistry();
    service.registerDevices(devices);
    const feedback: unknown[] = [];

    await devices
      .require<import("./ports").XfsPinpadDevicePort>("customPinpad")
      .getPin({
        customerData: "123456789012",
        onFeedback: (value: unknown) => feedback.push(value),
      });

    expect(feedback).toEqual([
      { digitCount: 0, state: "started" },
      { digitCount: 1, state: "changed" },
      { digitCount: 2, state: "changed" },
      { digitCount: 1, state: "changed" },
      { digitCount: 2, state: "changed" },
      { digitCount: 0, state: "cleared" },
      { digitCount: 1, state: "changed" },
      { digitCount: 1, state: "terminated" },
    ]);
    expect(feedback).not.toContainEqual(expect.objectContaining({ digit: expect.anything() }));
  });

  it("cancels active input sessions through the XFS cancellation path", async () => {
    const fake = createFakeXfsClient();
    const service = createXfsDeviceService(config(), { client: fake });
    await service.connect();
    const devices = new DeviceRegistry();
    const inputSources = new InputSourceRegistry();
    service.registerDevices(devices);
    service.registerInputSources(inputSources);

    const session = await inputSources
      .require("barcodeReader.qr")
      .start(executionContext(devices), {
        id: "qr",
        kind: "barcodeReader.qr",
      });
    await session.cancel("timeout");

    expect(fake.manager.cancelCalls).toEqual([
      { requestId: 0, sessionId: "customBarcode-session" },
    ]);
  });

  it("maps media status and resolves card custody after eject and take", async () => {
    const fake = createFakeXfsClient();
    const service = createXfsDeviceService(config(), { client: fake });
    await service.connect();
    const devices = new DeviceRegistry();
    service.registerDevices(devices);
    const card = devices.require<import("./ports").XfsCardReaderPort>("customCard");

    expect(await card.getMediaStatus()).toMatchObject({ state: "inside" });
    await card.ejectCard({ position: "exit" });
    await fake.idc.eventHandler?.({ data: { kind: "mediaRemoved" } });
    const taken = await card.waitForTaken({ pollIntervalMs: 1, timeoutMs: 50 });

    expect(taken).toMatchObject({ safeSummary: { taken: true }, taken: true });
    expect(fake.idc.ejectCalls).toHaveLength(1);
  });

  it("resets IDC before reading when the logical-service policy requires it", async () => {
    const fake = createFakeXfsClient();
    const base = config();
    const service = createXfsDeviceService({
      ...base,
      logicalServices: base.logicalServices.map((logicalService) =>
        logicalService.module === "idc"
          ? { ...logicalService, idc: { resetBeforeRead: true } }
          : logicalService),
    }, { client: fake });
    await service.connect();
    const devices = new DeviceRegistry();
    service.registerDevices(devices);

    await devices
      .require<import("./ports").XfsCardReaderPort>("customCard")
      .readCard();

    expect(fake.idc.resetCalls).toBe(1);
  });

  it("does not treat NOT_PRESENT status alone as customer take evidence", async () => {
    const fake = createFakeXfsClient();
    const service = createXfsDeviceService(config(), { client: fake });
    await service.connect();
    const devices = new DeviceRegistry();
    service.registerDevices(devices);
    const card = devices.require<import("./ports").XfsCardReaderPort>("customCard");

    await card.ejectCard({ position: "exit" });
    const taken = await card.waitForTaken({ pollIntervalMs: 1, timeoutMs: 5 });

    expect(taken).toMatchObject({ safeSummary: { taken: false }, taken: false });
  });

  it("closes sessions and disposes the XFS client", async () => {
    const fake = createFakeXfsClient();
    const service = createXfsDeviceService(config(), { client: fake });
    await service.connect();

    await service.dispose();

    expect(fake.manager.closeCalls.map((call) => call.sessionId)).toEqual([
      "customCard-session",
      "customPinpad-session",
      "customBarcode-session",
    ]);
    expect(fake.disposed).toBe(true);
  });

  it("disconnects the client when a protected session close is rejected", async () => {
    const fake = createFakeXfsClient();
    fake.manager.close = async () => {
      throw new Error("protected session must remain owner-bound");
    };
    const service = createXfsDeviceService(config(), { client: fake });
    await service.connect();

    await expect(service.dispose()).rejects.toThrow(
      "Failed to close XFS session for device",
    );
    expect(fake.disposed).toBe(true);
  });
});

const config = () => ({
  logicalServices: [
    {
      capabilities: ["card.read"],
      deviceId: "customCard",
      logicalName: "BANK_IDC_A",
      module: "idc" as const,
    },
    {
      capabilities: ["pin.getData", "pin.getPin"],
      dataClassification: "secret" as const,
      deviceId: "customPinpad",
      logicalName: "BANK_PIN_A",
      module: "pin" as const,
    },
    {
      capabilities: ["barcode.qr"],
      dataClassification: "sensitive" as const,
      deviceId: "customBarcode",
      logicalName: "BANK_BCR_A",
      module: "bcr" as const,
    },
  ],
  startup: { enabled: true },
  url: "ws://127.0.0.1:39010",
});

const executionContext = (devices: DeviceRegistry) => ({
  deviceLocks: new DeviceLockManager(),
  devices,
  flowId: "flow",
  flowVersion: "1.0.0",
  instanceId: "instance",
  nodeId: "node",
});

it("registers IDC service events for card removal evidence", async () => {
  const fake = createFakeXfsClient();
  const service = createXfsDeviceService(config(), { client: fake });

  await service.connect();

  expect(fake.manager.registerEventsCalls).toContainEqual({
    eventClass: 11,
    sessionId: "customCard-session",
  });
});

it("registers PIN execute events for safe input feedback", async () => {
  const fake = createFakeXfsClient();
  const service = createXfsDeviceService(config(), { client: fake });

  await service.connect();

  expect(fake.manager.registerEventsCalls).toContainEqual({
    eventClass: 8,
    sessionId: "customPinpad-session",
  });
});

const createFakeXfsClient = (options: {
  readonly idcFwDevice?: number;
  readonly pinEvents?: readonly import("./types").XfsPinEventLike[];
  readonly pinGetHResults?: readonly number[];
} = {}) => {
  const pinGetHResults = [...(options.pinGetHResults ?? [0])];
  const fake: XfsRuntimeClientLike & {
    connected: boolean;
    disposed: boolean;
    manager: XfsRuntimeClientLike["manager"] & {
      cancelCalls: Array<{ requestId: number; sessionId: string }>;
      closeCalls: Array<{ sessionId: string }>;
      registerEventsCalls: Array<{ eventClass: number; sessionId: string }>;
    };
    pin: XfsRuntimeClientLike["pin"] & {
      eventHandler?: (
        event: import("./types").XfsPinEventLike,
      ) => void | Promise<void>;
      getPinCalls: unknown[];
      getPinblockCalls: unknown[];
      resetCalls: number;
      unsubscribed: boolean;
    };
    idc: XfsRuntimeClientLike["idc"] & {
      ejectCalls: unknown[];
      eventHandler?: ((event: { data: { kind: string } }) => void | Promise<void>) | undefined;
      resetCalls: number;
      statusCalls: number;
    };
  } = {
    bcr: {
      getStatus: async () => ({ fwDevice: 0, native: { hResult: 0 } }),
      read: async () => ({
        native: { hResult: 0 },
        outputs: [
          {
            barcodeData: new TextEncoder().encode("qr-value"),
            symbologyName: "QR",
          },
        ],
      }),
    },
    connected: false,
    disposed: false,
    idc: {
      ejectCalls: [] as unknown[],
      resetCalls: 0,
      statusCalls: 0,
      ejectCard: async (request: unknown) => {
        fake.idc.ejectCalls.push(request);
        return { native: { hResult: 0 } };
      },
      getStatus: async () => {
        fake.idc.statusCalls += 1;
        return {
          fwDevice: options.idcFwDevice ?? 0,
          fwMedia: fake.idc.statusCalls < 3 ? 7 : 2,
          native: { hResult: 0 },
        };
      },
      readRawData: async () => ({ native: { hResult: 0 } }),
      reset: async () => {
        fake.idc.resetCalls += 1;
        return { native: { hResult: 0 } };
      },
      retainCard: async () => ({ native: { hResult: 0 } }),
      subscribeEvent: (handler) => {
        fake.idc.eventHandler = handler;
        return {};
      },
    },
    manager: {
      cancelCalls: [] as Array<{ requestId: number; sessionId: string }>,
      closeCalls: [] as Array<{ sessionId: string }>,
      registerEventsCalls: [] as Array<{ eventClass: number; sessionId: string }>,
      cancelAsyncRequest: async (request: { requestId: number; sessionId: string }) => {
        fake.manager.cancelCalls.push(request);
        return { hResult: 0 };
      },
      close: async (request: { sessionId: string }) => {
        fake.manager.closeCalls.push(request);
        return {};
      },
      open: async (request: { logicalName: string }) => ({
        native: { hResult: 0 },
        session: {
          id: `${deviceIdForLogicalName(request.logicalName)}-session`,
        },
      }),
      registerEvents: async (request: { eventClass: number; sessionId: string }) => {
        fake.manager.registerEventsCalls.push(request);
        return {};
      },
      startup: async () => ({ hResult: 0 }),
    },
    pin: {
      getData: async () => ({
        keys: [{ value: "1" }, { value: "2" }, { value: "3" }],
        native: { hResult: 0 },
      }),
      getPinblock: async (request: unknown) => {
        fake.pin.getPinblockCalls.push(request);
        return {
          data: new Uint8Array([1, 2, 3]),
          native: { hResult: 0 },
        };
      },
      getPin: async (request: unknown) => {
        fake.pin.getPinCalls.push(request);
        for (const event of options.pinEvents ?? []) {
          await fake.pin.eventHandler?.(event);
        }
        return { digits: 4, native: { hResult: pinGetHResults.shift() ?? 0 } };
      },
      getPinCalls: [] as unknown[],
      getPinblockCalls: [] as unknown[],
      getStatus: async () => ({ fwDevice: 0, native: { hResult: 0 } }),
      reset: async () => {
        fake.pin.resetCalls += 1;
        return { native: { hResult: 0 } };
      },
      resetCalls: 0,
      subscribeEvent: (handler) => {
        fake.pin.eventHandler = handler;
        return {
          unsubscribe: () => {
            fake.pin.unsubscribed = true;
          },
        };
      },
      unsubscribed: false,
    },
    connect: async () => {
      fake.connected = true;
    },
    dispose: async () => {
      fake.disposed = true;
    },
  };

  return fake;
};

const deviceIdForLogicalName = (logicalName: string): string => {
  if (logicalName.includes("IDC")) {
    return "customCard";
  }
  if (logicalName.includes("PIN")) {
    return "customPinpad";
  }
  return "customBarcode";
};
