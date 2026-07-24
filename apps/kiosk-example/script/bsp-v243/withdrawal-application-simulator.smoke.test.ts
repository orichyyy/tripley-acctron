import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  DeviceLockManager,
  DeviceRegistry,
} from "@tripley-kit/web-container-device-core";
import type { NativeTcpApi } from "@tripley-kit/web-container-kiosk-host-native-channel";
import { NodeSqliteConnection } from "@tripley-kit/web-container-storage-sqlite/node";
import {
  prepareHostdCdmSimulator,
  simulateCdmItemsTaken,
} from "@tripley-kit/web-container-xfs-test-harness";
import {
  createXfsDeviceService,
  type CashDeliveryDependencies,
} from "@tripley-kit/web-container-xfs-device-service";
import type { WithdrawalCashDeliveryPort } from "@tripley-kit/web-container-withdrawal-orchestration";
import { describe, expect, it } from "vitest";

import {
  TaiwanBspWithdrawalContextVault,
  createTaiwanBspWithdrawalHostContextProviders,
} from "../../src/runtime/taiwan-bsp-withdrawal-context";
import { createTaiwanBspWithdrawalApplication } from "../../src/runtime/taiwan-bsp-withdrawal";
import { createMemoryHostDelivery } from "./simulator-memory-delivery";
import { createBspV243WithdrawalHostRuntime } from "./withdrawal-runtime";

interface SmokeNative {
  readonly tcp: NativeTcpApi;
  connect(): Promise<void>;
  dispose(): Promise<void>;
}

interface NativeModule {
  createWebSocketTripleyNative(options: {
    readonly requiredServices: readonly string[];
    readonly url: string;
  }): SmokeNative;
}

const smoke = process.env.TARGET59_SIMULATOR_SMOKE === "1" ? it : it.skip;

describe("Target 59 BSP and XFS simulator vertical slice", () => {
  smoke("executes OEX, IWD, CDM delivery, and IWF", async () => {
    expect(process.env.TARGET59_SIMULATOR_CONFIRM).toBe("I_UNDERSTAND_SIMULATOR_ONLY");
    const hostdUrl = process.env.TARGET59_HOSTD_URL ?? "ws://127.0.0.1:39010";
    const cdm = await prepareHostdCdmSimulator({ url: hostdUrl });
    const native = await createNative(hostdUrl);
    const directory = await mkdtemp(join(tmpdir(), "tripley-target59-smoke-"));
    const devices = new DeviceRegistry();
    const vault = new TaiwanBspWithdrawalContextVault();
    const contexts = createTaiwanBspWithdrawalHostContextProviders(vault);
    const xfs = createXfsDeviceService({
      logicalServices: [{
        capabilities: ["cash.dispense", "cash.present", "cash.retract"],
        cdm: {
          configurationRevision: "target59-smoke",
          policyVersion: "1",
          protectionPolicyProfileId: "real-smoke",
          resourceGroup: "cash-transport-1",
        },
        deviceId: "cashDispenser",
        logicalName: cdm.logicalName,
        module: "cdm",
      }],
      url: hostdUrl,
    }, { cash: cashDependencies() });
    const host = createBspV243WithdrawalHostRuntime({
      createDelivery: createMemoryHostDelivery,
      host: process.env.BSP_V243_SIMULATOR_HOST ?? "127.0.0.1",
      hostOptions: {
        authorizationDeliveryPolicyId: "target59.authorization",
        completion: {
          context: contexts.completion,
          deliveryPolicyId: "target59.completion",
          reasonPolicy: { map: () => ({ kind: "", number: "000" }) },
        },
        contexts: { authorization: contexts.authorization },
      },
      port: environmentNumber("BSP_V243_SIMULATOR_PORT", 12008),
      tcp: native.tcp,
      terminalState: async () => terminalSnapshot,
    });
    let application: Awaited<ReturnType<typeof createTaiwanBspWithdrawalApplication>> | undefined;
    let cashStartError: unknown;
    try {
      await native.connect();
      await Promise.all([host.start(), xfs.connect()]);
      if (!host.supervisor.snapshot.available) {
        const snapshot = host.supervisor.snapshot;
        throw new Error(
          `BSP session not ready: state=${snapshot.state}, generation=${snapshot.generation}, reason=${snapshot.reasonCode ?? "none"}`,
        );
      }
      xfs.registerDevices(devices);
      const cash = devices.require<WithdrawalCashDeliveryPort>("cashDispenser");
      application = await createTaiwanBspWithdrawalApplication({
        cash: {
          start: async (request) => {
            try {
              return await cash.start(request);
            } catch (error) {
              cashStartError = error;
              throw error;
            }
          },
        },
        db: new NodeSqliteConnection(join(directory, "transactions.db")),
        host: host.host,
        hostFinancialCompletion: true,
        ownerInstanceId: "target59-simulator",
        protection: { recover: async () => ({ safeSummary: {}, status: "ready" as const }) },
        vault,
      });
      const operationId = `target59-${Date.now()}`;
      const simulation = new AbortController();
      const takeItems = simulateTakenWhenReady(
        hostdUrl,
        cdm.logicalName,
        simulation.signal,
      );
      try {
        const result = await application.execute({
          amount: { currency: "CNY", minorUnits: 10_000 },
          bspContext: withdrawalContext,
          entryMode: "cardless-reservation",
          operationId,
          safeMetadata: { smoke: true },
        });
        if (result.outcome.status !== "completed") {
          throw new Error(`Withdrawal ended before cash take: ${JSON.stringify({
            cash: result.outcome.cash,
            host: result.outcome.host,
            reason: result.outcome.reason,
            status: result.outcome.status,
            ...(cashStartError ? { cashStartError: safeError(cashStartError) } : {}),
          })}`);
        }
        await takeItems;
        expect(result.outcome).toMatchObject({
          cash: { custody: "taken", dispensed: true, presented: true, taken: true },
          host: { status: "approved" },
          status: "completed",
        });
        expect(result.finalization?.status).toBe("completed");
        process.stdout.write(`${JSON.stringify({
          authorization: "approved",
          cashCustody: result.outcome.cash.custody,
          event: "target59.withdrawal-application.passed",
          financialCompletion: "accepted",
          hostSession: host.supervisor.snapshot.state,
          logicalService: cdm.logicalName,
        })}\n`);
      } finally {
        simulation.abort();
        await takeItems.catch(() => undefined);
      }
    } finally {
      await application?.dispose().catch(() => undefined);
      await Promise.allSettled([xfs.dispose(), host.dispose(), native.dispose()]);
      await rm(directory, { force: true, recursive: true });
    }
  }, 60_000);
});

const createNative = async (hostdUrl: string): Promise<SmokeNative> => {
  const nativeDist = resolve(
    process.env.TRIPLEY_NATIVE_DIST ??
      "../../front-end/tripley-kit/libs/native/dist/index.js",
  );
  const module = await import(
    /* @vite-ignore */ pathToFileURL(nativeDist).href
  ) as NativeModule;
  return module.createWebSocketTripleyNative({
    requiredServices: ["runtime", "tcp"],
    url: hostdUrl,
  });
};

const cashDependencies = (): CashDeliveryDependencies => {
  let id = 0;
  let fencingSequence = Date.now() * 1_000 + 999;
  const receipt = () => ({
    id: `target59-evidence-${++id}`,
    persistedAt: new Date().toISOString(),
  });
  const nextFencingToken = () => {
    fencingSequence = Math.max(fencingSequence + 1, Date.now() * 1_000 + 999);
    return fencingSequence;
  };
  return {
    deviceLocks: new DeviceLockManager(),
    emergencySpool: { append: async () => undefined },
    evidence: {
      append: async () => receipt(),
      recordAfterSnapshot: async () => receipt(),
      recordBeforeMovement: async () => receipt(),
    },
    idFactory: () => `target59-cash-${++id}`,
    recoveryLeases: {
      acquire: async (input) => ({
        ...input,
        fencingToken: nextFencingToken(),
        id: `target59-recovery-${id}`,
      }),
      close: async () => undefined,
      hasUnresolved: async () => false,
      update: async () => undefined,
    },
  };
};

const simulateTakenWhenReady = async (
  url: string,
  logicalName: string,
  signal: AbortSignal,
): Promise<void> => {
  const deadline = Date.now() + 20_000;
  let lastError: unknown;
  while (!signal.aborted && Date.now() < deadline) {
    try {
      await simulateCdmItemsTaken({ logicalName, url });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
  }
  throw new Error("Timed out waiting for simulated cash presentation.", { cause: lastError });
};

const terminalSnapshot = {
  atmId: process.env.BSP_V243_ATM_ID ?? "00000",
  businessDate: process.env.BSP_V243_BUSINESS_DATE ?? "01150724",
  depositMode: "6",
  deviceStatus: "000000030000",
  mode: "1",
  sequence: process.env.BSP_V243_OEX_SEQUENCE ?? "00000175",
  serviceStatus: "1",
  systemDate: process.env.BSP_V243_SYSTEM_DATE ?? "01150724",
  versionDate: process.env.BSP_V243_VERSION_DATE ?? "20260723",
};

const withdrawalContext = {
  header: {
    atmId: terminalSnapshot.atmId,
    businessDate: terminalSnapshot.businessDate,
    sequence: process.env.BSP_V243_WITHDRAWAL_SEQUENCE ?? "00000176",
    systemDate: terminalSnapshot.systemDate,
    versionDate: terminalSnapshot.versionDate,
    versionMarker: "A",
  },
  ici: {
    inBankNumber: "807",
    inCardAccount: "6222020000000058",
    inCurrencyCode: "01",
    inMac: "00000000",
    inPinBlock: "0000000000000000",
    inTrack3: "",
    inTransactionAccount: "0000000000000058",
    inTransactionAmount: "00000100",
  },
};

const environmentNumber = (name: string, fallback: number): number => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
    throw new Error(`Environment value is not a valid port: ${name}`);
  }
  return value;
};

const safeError = (error: unknown): Readonly<Record<string, unknown>> => {
  if (!(error instanceof Error)) return { kind: typeof error };
  const record = error as Error & {
    readonly category?: unknown;
    readonly code?: unknown;
  };
  return {
    name: error.name,
    message: error.message,
    ...(typeof record.category === "string" ? { category: record.category } : {}),
    ...(typeof record.code === "string" ? { code: record.code } : {}),
  };
};
