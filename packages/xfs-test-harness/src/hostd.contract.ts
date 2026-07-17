import {
  type TripleyXfsClient,
  XfsPinKeyUseFromRaw,
  createWebSocketXfsClient,
} from "@tripley-kit/xfs-client";
import {
  DeviceLockManager,
  DeviceRegistry,
  InputSourceRegistry,
  type SecurePinInputResult,
} from "@tripley/web-container-device-core";
import {
  type XfsCardReaderPort,
  XfsDeviceService,
  type XfsHealthCheckResult,
} from "@tripley/web-container-xfs-device-service";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createExampleApplicationRuntime } from "../../../apps/kiosk-example/src/runtime/create-runtime";
import type { ExampleApplicationRuntime } from "../../../apps/kiosk-example/src/runtime/types";

import { xfsHostdTestConfigFromEnv } from "./config";
import { XfsTestCommandLeaseSet } from "./command-leases";
import { withContractTimeout } from "./contract-timeout";
import { XfsHostdTestHarness, type XfsSimulatorLogicalServices } from "./harness";
import { prepareIdcNoMedia } from "./idc-preconditions";

describe.sequential("hostd-backed XFS device contracts", () => {
  const config = xfsHostdTestConfigFromEnv();
  const harness = new XfsHostdTestHarness(config);
  const runtimeClient = createWebSocketXfsClient({
    ...(config.authToken ? { authToken: config.authToken } : {}),
    commandLeasing: "required",
    requiredModules: ["manager", "idc", "pin", "bcr"],
    url: config.url,
  });
  const devices = new DeviceRegistry();
  const inputSources = new InputSourceRegistry();
  let names: XfsSimulatorLogicalServices;
  let service: XfsDeviceService;
  let application: ExampleApplicationRuntime;
  let commandLeases: XfsTestCommandLeaseSet;
  let baselineActiveSessions = 0;
  const healthHistory: XfsHealthCheckResult[][] = [];
  const healthAnomalies: XfsHealthCheckResult[][] = [];

  beforeAll(async () => {
    await harness.connect();
    names = await harness.discoverLogicalServices();
    await runtimeClient.connect();
    baselineActiveSessions = (await runtimeClient.manager.runtimeStatus({})).activeSessions;
    service = new XfsDeviceService(
      {
        appId: config.appId,
        ...(config.authToken ? { authToken: config.authToken } : {}),
        logicalServices: [
          {
            capabilities: ["card.read"],
            deviceId: "cardReader",
            logicalName: names.idc,
            module: "idc",
          },
          {
            capabilities: ["pin.getData", "pin.getPin"],
            dataClassification: "secret",
            deviceId: "pinpad",
            logicalName: names.pin,
            module: "pin",
          },
          {
            capabilities: ["barcode.qr"],
            dataClassification: "sensitive",
            deviceId: "barcodeReader",
            logicalName: names.bcr,
            module: "bcr",
          },
        ],
        timeoutMs: config.timeoutMs,
        url: config.url,
      },
      { client: runtimeClient },
    );
    await service.connect();
    const idcSetupLease = await XfsTestCommandLeaseSet.acquire(
      runtimeClient,
      [names.idc],
      "transaction",
    );
    const pinSetupLease = await XfsTestCommandLeaseSet.acquire(
      runtimeClient,
      [names.pin],
      "maintenance",
    );
    try {
      await prepareSimulatorRuntime(runtimeClient, names, config);
      await prepareIdcNoMedia(runtimeClient, harness, names.idc, config.timeoutMs);
    } finally {
      await pinSetupLease.release();
      await idcSetupLease.release();
    }
    commandLeases = await XfsTestCommandLeaseSet.acquire(runtimeClient, [
      names.idc,
      names.pin,
      names.bcr,
    ]);
    service.registerDevices(devices);
    service.registerInputSources(inputSources);
    application = await createExampleApplicationRuntime({
      connectHostd: async (_hostd, appDevices, appInputSources) => {
        service.registerDevices(appDevices);
        service.registerInputSources(appInputSources);
        const checkCapabilities = async () => {
          const checks = await Promise.all(service.healthChecks().map((check) => check.check()));
          healthHistory.push(checks);
          if (checks.some((check) => check.status !== "healthy")) {
            healthAnomalies.push(checks);
          }
          const health = {
            capabilities: {
              "device.bcr": capabilityStatus(checks, "barcodeReader"),
              "device.idc": capabilityStatus(checks, "cardReader"),
              "device.pin": capabilityStatus(checks, "pinpad"),
            },
            checkedAt: new Date().toISOString(),
            checks: checks.map(({ id, status }) => ({ id, status })),
          };
          return health;
        };
        const health = await checkCapabilities();
        return {
          capabilities: health.capabilities,
          checkCapabilities,
          dispose: async () => {},
          health,
          service,
        };
      },
      hostd: {
        ...(config.authToken ? { authToken: config.authToken } : {}),
        bcrLogicalName: names.bcr,
        idcLogicalName: names.idc,
        pinLogicalName: names.pin,
        pinCustomerData: config.pinCustomerData,
        pinKeyName: config.pinKeyName,
        url: config.url,
      },
      healthPollIntervalMs: 50,
      mode: "hostd",
    });
  });

  afterAll(async () => {
    if (names) {
      await harness.takeCard(names.idc).catch(() => undefined);
    }
    await application?.dispose().catch(() => undefined);
    await commandLeases?.release().catch(() => undefined);
    await service?.dispose().catch(() => undefined);
    await harness.dispose().catch(() => undefined);
  });

  it("discovers and registers canonical IDC, PIN, and BCR services", async () => {
    expect(names).toEqual({
      bcr: expect.any(String),
      idc: expect.any(String),
      pin: expect.any(String),
    });
    expect(devices.list().map((device) => device.id)).toEqual([
      "cardReader",
      "pinpad",
      "barcodeReader",
    ]);
    await expect(
      Promise.all(service.healthChecks().map((check) => check.check())),
    ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ status: "healthy" })]));
  });

  it("reports runtime generation and refuses recycle while logical sessions are active", async () => {
    const status = await runtimeClient.manager.runtimeStatus({});
    expect(status).toMatchObject({
      canRecycle: false,
      generation: config.expectedGeneration,
      initialized: true,
    });
    expect(status.activeSessions).toBeGreaterThanOrEqual(baselineActiveSessions + 3);
    await expect(
      runtimeClient.manager.recycleRuntime({
        versionsRequired: { high: 0x2803, low: 0x0203 },
      }),
    ).rejects.toThrow(/recycle requires idle state|blocked by an unresolved command lease/i);
  });

  it("reads, ejects, and resolves custody for an IDC simulator card", async () => {
    await prepareIdcNoMedia(runtimeClient, harness, names.idc, config.timeoutMs);
    const card = devices.require<XfsCardReaderPort>("cardReader");
    const resultPromise = card.readCard({ dataSources: 2 });
    await harness.insertTestCard(names.idc);
    const result = await resultPromise;
    expect(result.safeSummary).toMatchObject({ sourceKind: "cardReader.track" });
    await card.ejectCard({ position: "exit" });
    const takenResult = card.waitForTaken({ pollIntervalMs: 25, timeoutMs: config.timeoutMs });
    await harness.takeCard(names.idc);
    await expect(takenResult).resolves.toMatchObject({ taken: true });
  });

  it("completes plain PIN data through the registered input source", async () => {
    const session = await inputSources.require("pinpad.data").start(executionContext(devices), {
      id: "amount",
      kind: "pinpad.data",
      options: { activeKeys: 0x03ff, maxLength: 2, terminateKeys: 0x0400 },
    });
    await harness.pressPinDigits(names.pin, "12");
    await expect(session.result).resolves.toMatchObject({
      safeSummary: { sourceKind: "pinpad.data" },
      value: "12",
    });
  });

  it("returns only a safe encrypted summary for secure PIN input", async () => {
    const session = await inputSources.require("pinpad.pin").start(executionContext(devices), {
      id: "pin",
      kind: "pinpad.pin",
      options: {
        activeKeys: 0x03ff,
        customerData: config.pinCustomerData,
        format: 2,
        keyName: config.pinKeyName,
        maxLength: 4,
        minLength: 4,
      },
      secure: true,
    });
    await harness.pressPinDigits(names.pin, "1234");
    const result = (await session.result) as SecurePinInputResult;
    expect(result).toMatchObject({
      kind: "securePin",
      safeSummary: { hasEncryptedPinBlock: true, sourceKind: "pinpad.pin" },
    });
    expect(JSON.stringify(result.safeSummary)).not.toContain("1234");
    expect(result.encryptedPinBlock).not.toContain("1234");
  });

  it("completes and cancels BCR sessions through the control and runtime planes", async () => {
    const adapter = inputSources.require("barcodeReader.qr");
    const completed = await adapter.start(executionContext(devices), {
      id: "qr-complete",
      kind: "barcodeReader.qr",
    });
    await harness.completeBarcode(names.bcr, "acctron://contract/qr");
    await expect(completed.result).resolves.toMatchObject({ value: "acctron://contract/qr" });

    const cancelled = await adapter.start(executionContext(devices), {
      id: "qr-cancel",
      kind: "barcodeReader.qr",
    });
    const cancelledResult = cancelled.result.catch(() => undefined);
    await cancelled.cancel("contract cancellation");
    await harness.waitForBarcodeIdle(names.bcr);
    await cancelledResult;
  });

  it("projects a real hostd card and PIN operation through the kiosk application runtime", async () => {
    await prepareIdcNoMedia(runtimeClient, harness, names.idc, config.timeoutMs);
    healthHistory.length = 0;
    healthAnomalies.length = 0;
    const result = application.runtime.start({
      entryMethodId: "card.contact",
      intentId: "hostd-vertical-slice",
    });
    await runSimulatorWhenReady(() => harness.insertTestCard(names.idc), "IDC card read", result);
    await submitWhen(application, "withdrawal.amount", "500", () =>
      applicationContext(application, healthHistory, healthAnomalies),
    );
    await waitUntil(() => application.runtime.snapshot().operation.promptId === "pin.enter");
    await runSimulatorWhenReady(
      () => harness.pressPinDigits(names.pin, "1234", { terminate: true }),
      "PIN entry",
      result,
    );
    const cardTakeRequired = await waitForPromptOrReturnedCard(application, result);
    if (cardTakeRequired) {
      await runSimulatorWhenReady(() => harness.takeCard(names.idc), "IDC card take");
    }

    await expect(result).resolves.toMatchObject({
      entryMethodId: "card.contact",
      status: "completed",
    });
    expect(application.runtime.snapshot().operation.mediaCustody).toBe("returned");
    const projection = JSON.stringify({
      runtime: application.runtime.snapshot(),
      ui: application.store.getState(),
    });
    expect(projection).not.toContain("1234");
    expect(projection).not.toContain(config.pinCustomerData);
  });

  it("updates entry availability and interrupts only IDC-dependent work after device loss", async () => {
    await prepareIdcNoMedia(runtimeClient, harness, names.idc, config.timeoutMs);
    const previousOperationId = application.runtime.snapshot().operation.operationId;
    const result = application.runtime.start({
      entryMethodId: "card.contact",
      intentId: "hostd-idc-loss",
    });
    await waitUntil(
      () => {
        const operationId = application.runtime.snapshot().operation.operationId;
        return Boolean(operationId) && operationId !== previousOperationId;
      },
      () => applicationContext(application, healthHistory, healthAnomalies),
    );

    await harness.setIdcAvailable(names.idc, false);
    try {
      await expect(withContractTimeout(
        result,
        5_000,
        () => applicationContext(application, healthHistory, healthAnomalies),
      )).resolves.toMatchObject({
        entryMethodId: "card.contact",
        status: "interrupted",
      });
      await waitUntil(
        () =>
          application.runtime
            .snapshot()
            .readiness.entryMethods.find((entry) => entry.id === "card.contact")?.available ===
          false,
      );

      const entries = new Map(
        application.runtime
          .snapshot()
          .readiness.entryMethods.map((entry) => [entry.id, entry.available]),
      );
      expect(entries.get("card.contact")).toBe(false);
      expect(entries.get("qr")).toBe(true);
      expect(entries.get("reservation")).toBe(true);
    } finally {
      await harness.setIdcAvailable(names.idc, true);
    }
  });
});

const capabilityStatus = (
  checks: readonly XfsHealthCheckResult[],
  deviceId: string,
): "available" | "degraded" | "unavailable" => {
  const status = checks.find((check) => check.id === `xfs.${deviceId}.health`)?.status;
  return status === "healthy" ? "available" : status === "degraded" ? "degraded" : "unavailable";
};

const applicationContext = (
  application: ExampleApplicationRuntime,
  healthHistory: readonly (readonly XfsHealthCheckResult[])[],
  healthAnomalies: readonly (readonly XfsHealthCheckResult[])[],
) => ({
  healthAnomalies,
  healthHistory: healthHistory.slice(-20),
  runtime: application.runtime.snapshot(),
});

const submitWhen = async (
  application: ExampleApplicationRuntime,
  promptId: string,
  value: string,
  context?: () => unknown,
): Promise<void> => {
  await waitUntil(
    () => application.runtime.snapshot().operation.promptId === promptId,
    context ?? (() => application.runtime.snapshot()),
  );
  await application.commands.execute("kiosk.input.submit", {}, { value });
};

const waitForPromptOrReturnedCard = async (
  application: ExampleApplicationRuntime,
  operationResult: Promise<{ readonly status: string }>,
): Promise<boolean> =>
  Promise.race([
    waitUntil(() => application.runtime.snapshot().operation.promptId === "card.take").then(
      () => true,
    ),
    operationResult.then((result) => {
      const operation = application.runtime.snapshot().operation;
      if (result.status === "completed" && operation.mediaCustody === "returned") {
        return false;
      }
      throw new Error(
        `Kiosk operation ended before card return: ${JSON.stringify({ operation, result })}`,
      );
    }),
  ]);

const waitUntil = async (predicate: () => boolean, context?: () => unknown): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for hostd-backed kiosk projection.${
          context ? ` State: ${JSON.stringify(context())}` : ""
        }`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const runSimulatorWhenReady = async (
  action: () => Promise<void>,
  operation: string,
  operationResult?: Promise<unknown>,
): Promise<void> => {
  const simulatorAction = retrySimulatorAction(action, operation);
  if (!operationResult) {
    return simulatorAction;
  }
  await Promise.race([
    simulatorAction,
    operationResult.then((result) => {
      throw new Error(
        `Kiosk operation ended before simulator readiness during ${operation}: ${JSON.stringify(result)}`,
      );
    }),
  ]);
};

const retrySimulatorAction = async (
  action: () => Promise<void>,
  operation: string,
): Promise<void> => {
  const deadline = Date.now() + 5_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await action();
      return;
    } catch (error) {
      lastError = error;
      if (!isSimulatorReadinessError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`Timed out waiting for simulator readiness during ${operation}.`, {
    cause: lastError,
  });
};

const isSimulatorReadinessError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return /no pending|no card|not .*position/i.test(error.message);
};

const executionContext = (devices: DeviceRegistry) => ({
  deviceLocks: new DeviceLockManager(),
  devices,
  flowId: "xfs-contract",
  flowVersion: "1.0.0",
  instanceId: "xfs-contract-instance",
  nodeId: "xfs-contract-node",
});

const prepareSimulatorRuntime = async (
  client: TripleyXfsClient,
  names: XfsSimulatorLogicalServices,
  config: ReturnType<typeof xfsHostdTestConfigFromEnv>,
): Promise<void> => {
  const request = (logicalName: string) => ({
    appId: `${config.appId}.setup`,
    logicalName,
    serviceVersionsRequired: { high: 0x2803, low: 0x0203 },
    timeoutMs: config.timeoutMs,
    traceLevel: 0,
  });

  const idc = await client.manager.open(request(names.idc));
  try {
    const result = await client.idc.reset({
      sessionId: idc.session.id,
      timeoutMs: config.timeoutMs,
    });
    expect(result.hResult).toBe(0);
  } finally {
    await client.manager.close({ sessionId: idc.session.id });
  }

  const pin = await client.manager.open(request(names.pin));
  try {
    const initialized = await client.pin.initialization({
      sessionId: pin.session.id,
      timeoutMs: config.timeoutMs,
    });
    expect(initialized.native.hResult).toBe(0);
    const reset = await client.pin.reset({
      sessionId: pin.session.id,
      timeoutMs: config.timeoutMs,
    });
    expect(reset.hResult).toBe(0);
    const imported = await client.pin.importKey({
      keyName: config.pinKeyName,
      sessionId: pin.session.id,
      timeoutMs: config.timeoutMs,
      useFlags: XfsPinKeyUseFromRaw(1 | 2 | 0x20000000),
      value: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    });
    expect(imported.native.hResult).toBe(0);
  } finally {
    await client.manager.close({ sessionId: pin.session.id });
  }
};
