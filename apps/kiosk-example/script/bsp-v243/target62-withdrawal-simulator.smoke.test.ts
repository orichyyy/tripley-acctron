import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  DeviceRegistry,
  InputSourceRegistry,
  type SecurePinInputResult,
} from "@tripley-kit/web-container-device-core";
import type { NativeTcpApi } from "@tripley-kit/web-container-kiosk-host-native-channel";
import { NodeSqliteConnection } from "@tripley-kit/web-container-storage-sqlite/node";
import {
  XfsHostdTestHarness,
  XfsTestCommandLeaseSet,
  prepareHostdCdmSimulator,
  prepareIdcNoMedia,
  simulateCdmItemsTaken,
  xfsHostdTestConfigFromEnv,
} from "@tripley-kit/web-container-xfs-test-harness";
import {
  createTripleyKitXfsRuntimeClient,
  createXfsDeviceService,
  type XfsCardReaderPort,
} from "@tripley-kit/web-container-xfs-device-service";
import type {
  WithdrawalCashDeliveryPort,
} from "@tripley-kit/web-container-withdrawal-orchestration";
import { describe, expect, it } from "vitest";

import {
  TaiwanBspWithdrawalContextVault,
  createTaiwanBspWithdrawalHostContextProviders,
} from "../../src/runtime/taiwan-bsp-withdrawal-context";
import { createTaiwanBspWithdrawalApplication } from "../../src/runtime/taiwan-bsp-withdrawal";
import { createMemoryHostDelivery } from "./simulator-memory-delivery";
import { createTaiwanBspContactCardContextAssembler } from "./taiwan-contact-card-context";
import {
  createTarget62CardCustody,
  createTarget62CashDependencies,
  retryTarget62SimulatorAction,
  safeTarget62Error,
  target62EnvironmentNonNegativeNumber,
  target62EnvironmentNumber,
  target62InputContext,
} from "./target62-smoke-support";
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

const smoke = process.env.TARGET62_SIMULATOR_SMOKE === "1" ? it : it.skip;

describe("Target 62 Taiwan BSP operation-context simulator smoke", () => {
  smoke("executes IDC, secure PIN, IWD, card return, CDM, and IWF", async () => {
    expect(process.env.TARGET62_SIMULATOR_CONFIRM).toBe(
      "I_UNDERSTAND_SIMULATOR_ONLY",
    );
    const hostdUrl =
      process.env.TRIPLEY_NATIVE_HOSTD_URL ?? "ws://127.0.0.1:39010";
    const harnessConfig = xfsHostdTestConfigFromEnv({
      ...process.env,
      TRIPLEY_NATIVE_HOSTD_URL: hostdUrl,
    });
    const harness = new XfsHostdTestHarness(harnessConfig);
    const native = await createNative(hostdUrl);
    const directory = await mkdtemp(join(tmpdir(), "tripley-target62-smoke-"));
    const devices = new DeviceRegistry();
    const inputSources = new InputSourceRegistry();
    const vault = new TaiwanBspWithdrawalContextVault();
    const contexts = createTaiwanBspWithdrawalHostContextProviders(vault);
    let application:
      | Awaited<ReturnType<typeof createTaiwanBspWithdrawalApplication>>
      | undefined;
    let xfs:
      | ReturnType<typeof createXfsDeviceService>
      | undefined;
    let host:
      | ReturnType<typeof createBspV243WithdrawalHostRuntime>
      | undefined;
    const commandLeases: XfsTestCommandLeaseSet[] = [];
    const observedIdcEventKinds = new Set<string>();
    const observedIdcPositions = new Set<number>();
    let idcTakeCompleted = false;
    let cashStartError: unknown;
    let idcLogicalName: string | undefined;

    try {
      await harness.connect();
      const names = await harness.discoverLogicalServices();
      idcLogicalName = names.idc;
      await harness.ensureNoCard(names.idc);
      const cdm = await prepareHostdCdmSimulator({
        currencyId: "TWD",
        denomination: 100,
        profileName: "tripley-acctron-target62-twd",
        url: hostdUrl,
      });
      const xfsClient = createTripleyKitXfsRuntimeClient({
        authToken: harnessConfig.authToken,
        requiredModules: ["manager", "idc", "pin", "cdm"],
        url: hostdUrl,
      });
      xfs = createXfsDeviceService({
        logicalServices: [
          {
            capabilities: ["card.read"],
            deviceId: "cardReader",
            logicalName: names.idc,
            module: "idc",
          },
          {
            capabilities: ["pin.getPin"],
            dataClassification: "secret",
            deviceId: "pinpad",
            logicalName: names.pin,
            module: "pin",
          },
          {
            capabilities: ["cash.dispense", "cash.present", "cash.retract"],
            cdm: {
              configurationRevision: "target62-smoke",
              policyVersion: "1",
              protectionPolicyProfileId: "real-smoke",
              resourceGroup: "cash-transport-1",
              tellerId: target62EnvironmentNonNegativeNumber(
                "TARGET62_CDM_TELLER_ID",
                cdm.tellerId,
              ),
            },
            deviceId: "cashDispenser",
            logicalName: cdm.logicalName,
            module: "cdm",
          },
        ],
        url: hostdUrl,
      }, {
        cash: createTarget62CashDependencies(),
        client: xfsClient,
      });
      await xfsClient.connect();
      const leaseClient =
        xfsClient as unknown as Parameters<
          typeof XfsTestCommandLeaseSet.acquire
        >[0];
      commandLeases.push(
        await XfsTestCommandLeaseSet.acquire(
          leaseClient,
          [names.idc],
          "transaction",
          {
            ownerInstanceId: "target62-simulator",
            protectionPolicyProfileId:
              harnessConfig.protectionProfileId,
            resourceGroup:
              process.env.TARGET62_IDC_RESOURCE_GROUP ??
              "card-transport-1",
          },
        ),
      );
      commandLeases.push(
        await XfsTestCommandLeaseSet.acquire(
          leaseClient,
          [names.pin],
          "transaction",
          {
            ownerInstanceId: "target62-simulator",
            protectionPolicyProfileId:
              harnessConfig.protectionProfileId,
            resourceGroup:
              process.env.TARGET62_PIN_RESOURCE_GROUP ??
              "pin-input-1",
          },
        ),
      );
      await prepareIdcNoMedia(
        leaseClient,
        harness,
        names.idc,
        harnessConfig.timeoutMs,
      );
      await xfs.connect();
      if (xfsClient.idc.subscribeEvent === undefined) {
        throw new Error("Target 62 requires IDC event subscription support");
      }
      xfsClient.idc.subscribeEvent((event) => {
        const kind = event.data?.kind;
        if (kind !== undefined) {
          observedIdcEventKinds.add(kind);
        }
      });
      xfs.registerDevices(devices);
      xfs.registerInputSources(inputSources);

      host = createBspV243WithdrawalHostRuntime({
        createDelivery: createMemoryHostDelivery,
        host: process.env.BSP_V243_SIMULATOR_HOST ?? "127.0.0.1",
        hostOptions: {
          authorizationDeliveryPolicyId: "target62.authorization",
          completion: {
            context: contexts.completion,
            deliveryPolicyId: "target62.completion",
            reasonPolicy: { map: () => ({ kind: "", number: "000" }) },
          },
          contexts: { authorization: contexts.authorization },
        },
        port: target62EnvironmentNumber("BSP_V243_SIMULATOR_PORT", 12008),
        tcp: native.tcp,
        terminalState: async () => terminalSnapshot(),
      });
      await native.connect();
      await host.start();
      if (!host.supervisor.snapshot.available) {
        throw new Error(
          `BSP session unavailable: ${JSON.stringify(host.supervisor.snapshot)}`,
        );
      }

      const operationId = `target62-${Date.now()}`;
      const card = devices.require<XfsCardReaderPort>("cardReader");
      const cardResultPromise = card.readCard({ dataSources: 2 });
      const insertCard = retryTarget62SimulatorAction(
        () => harness.insertTestCard(names.idc),
        "IDC card insertion",
      );
      await Promise.race([insertCard, cardResultPromise.then(() => undefined)]);
      const cardResult = await cardResultPromise;
      await insertCard;

      const pinSession = await inputSources
        .require("pinpad.pin")
        .start(target62InputContext(devices), {
          id: "pin.online",
          kind: "pinpad.pin",
          options: {
            activeKeys: 0x03ff,
            customerData: harnessConfig.pinCustomerData,
            format: 2,
            keyName: harnessConfig.pinKeyName,
            maxLength: 4,
            minLength: 4,
            terminateKeys: 0x0400,
          },
          required: true,
          secure: true,
        });
      const enterPin = retryTarget62SimulatorAction(
        () => harness.pressPinDigits(names.pin, "1234", { terminate: true }),
        "secure PIN entry",
      );
      await Promise.race([enterPin, pinSession.result.then(() => undefined)]);
      const pinResult = (await pinSession.result) as SecurePinInputResult;
      await enterPin;

      const amount = target62EnvironmentNumber("TARGET62_WITHDRAWAL_AMOUNT", 100);
      const assembled = await createAssembler().assemble({
        amount,
        assessment: { entryMethodId: "card.contact" },
        materials: {
          authentication: { "pin.online": pinResult },
          credential: {
            entryMethodId: "card.contact",
            material: cardResult,
            operationId,
          },
        },
        operationId,
      });
      expect(JSON.stringify(assembled.safeMetadata)).not.toContain(
        pinResult.encryptedPinBlock,
      );

      const cash = devices.require<WithdrawalCashDeliveryPort>("cashDispenser");
      const cardCustody = createTarget62CardCustody(card, names.idc);
      application = await createTaiwanBspWithdrawalApplication({
        card: cardCustody.port,
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
        ownerInstanceId: "target62-simulator",
        protection: {
          recover: async () => ({ safeSummary: {}, status: "ready" as const }),
        },
        vault,
      });

      const simulation = new AbortController();
      const takeCard = captureSimulatorAction(
        waitForTarget62Presentation(
          cardCustody.awaitingTake,
          simulation.signal,
        ).then(() => retryTarget62SimulatorAction(
          async () => {
            const position = await harness.cardMediaPosition(names.idc);
            observedIdcPositions.add(position);
            if (position !== 3) {
              throw new Error(`IDC card is not at the exit slot (position=${position}).`);
            }
            await harness.takeCard(names.idc);
            idcTakeCompleted = true;
          },
          "IDC card take",
          simulation.signal,
        )),
      );
      const takeCash = captureSimulatorAction(
        retryTarget62SimulatorAction(
          () => simulateCdmItemsTaken({
            logicalName: cdm.logicalName,
            url: hostdUrl,
          }),
          "CDM cash take",
          simulation.signal,
        ),
      );
      try {
        const result = await application.execute({
          amount: {
            currency: "TWD",
            minorUnits:
              amount *
              target62EnvironmentNumber("TARGET62_MINOR_UNIT_FACTOR", 100),
          },
          bspContext: assembled.bspContext,
          entryMode: assembled.entryMode,
          operationId,
          safeMetadata: assembled.safeMetadata,
        });
        if (result.outcome.status !== "completed") {
          throw new Error(
            `Target 62 withdrawal failed: ${JSON.stringify({
              card: result.outcome.card,
              cash: result.outcome.cash,
              ...(cashStartError
                ? { cashStartError: safeTarget62Error(cashStartError) }
                : {}),
              host: result.outcome.host,
              idcEventKinds: [...observedIdcEventKinds],
              idcPositions: [...observedIdcPositions],
              idcTakeCompleted,
              reason: result.outcome.reason,
              status: result.outcome.status,
            })}`,
          );
        }
        const simulatorActions = await Promise.all([takeCard, takeCash]);
        const failedAction = simulatorActions.find(
          (action) => action.status === "failed",
        );
        if (failedAction?.status === "failed") {
          throw new Error("Target 62 simulator action failed", {
            cause: failedAction.error,
          });
        }
        expect(result.outcome).toMatchObject({
          card: { status: "returned" },
          cash: {
            custody: "taken",
            dispensed: true,
            presented: true,
            taken: true,
          },
          host: { status: "approved" },
          status: "completed",
        });
        expect(result.finalization?.status).toBe("completed");
        process.stdout.write(`${JSON.stringify({
          cardCustody: result.outcome.card.status,
          cashCustody: result.outcome.cash.custody,
          credentialMapperId: assembled.safeMetadata.credentialMapperId,
          event: "target62.withdrawal.passed",
          financialCompletion: "accepted",
          hostSession: host.supervisor.snapshot.state,
          idcLogicalService: names.idc,
          pinLogicalService: names.pin,
        })}\n`);
      } finally {
        simulation.abort();
        await Promise.all([takeCard, takeCash]);
      }
    } catch (error) {
      process.stderr.write(`${JSON.stringify({
        error: safeTarget62Error(error),
        event: "target62.withdrawal.failed",
      })}\n`);
      throw error;
    } finally {
      await application?.dispose().catch(() => undefined);
      if (idcLogicalName !== undefined) {
        await harness.ensureNoCard(idcLogicalName).catch(() => undefined);
      }
      for (const lease of [...commandLeases].reverse()) {
        await lease.release().catch(() => undefined);
      }
      await Promise.allSettled([
        xfs?.dispose(),
        host?.dispose(),
        native.dispose(),
        harness.dispose(),
      ]);
      await rm(directory, { force: true, recursive: true });
    }
  }, 90_000);
});

function createAssembler() {
  const snapshot = terminalSnapshot();
  return createTaiwanBspContactCardContextAssembler({
    bankNumber: process.env.BSP_V243_BANK_NUMBER ?? "807",
    clock: {
      currentDates: () => ({
        businessDate: snapshot.businessDate,
        macDate:
          process.env.BSP_V243_MAC_DATE ??
          snapshot.systemDate.slice(-6),
        systemDate: snapshot.systemDate,
      }),
    },
    resolveTransactionAccount: ({ pan }) =>
      process.env.BSP_V243_TRANSACTION_ACCOUNT ?? pan,
    security: {
      protect: () => ({
        mac: process.env.BSP_V243_MAC ?? "00000000",
        terminalCheck:
          process.env.BSP_V243_TERMINAL_CHECK ?? "00000000",
      }),
    },
    sequence: {
      next: () =>
        process.env.BSP_V243_WITHDRAWAL_SEQUENCE ?? "00000176",
    },
    terminal: {
      atmId: snapshot.atmId,
      currencyCode: process.env.BSP_V243_CURRENCY_CODE ?? "01",
      depositMode: snapshot.depositMode,
      deviceStatus: snapshot.deviceStatus,
      mode: snapshot.mode,
      serviceStatus: snapshot.serviceStatus,
      transmissionArea: "  ",
      versionDate: snapshot.versionDate,
      versionMarker: process.env.BSP_V243_VERSION_MARKER ?? "A",
    },
    track2Source: 2,
  });
}

function terminalSnapshot() {
  return {
    atmId: process.env.BSP_V243_ATM_ID ?? "00000",
    businessDate: process.env.BSP_V243_BUSINESS_DATE ?? "01150724",
    depositMode: process.env.BSP_V243_DEPOSIT_MODE ?? "6",
    deviceStatus: process.env.BSP_V243_DEVICE_STATUS ?? "000000030000",
    mode: process.env.BSP_V243_ATM_MODE ?? "1",
    sequence: process.env.BSP_V243_OEX_SEQUENCE ?? "00000175",
    serviceStatus: process.env.BSP_V243_SERVICE_STATUS ?? "1",
    systemDate: process.env.BSP_V243_SYSTEM_DATE ?? "01150724",
    versionDate: process.env.BSP_V243_VERSION_DATE ?? "20260723",
  };
}

async function createNative(hostdUrl: string): Promise<SmokeNative> {
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
}

function waitForTarget62Presentation(
  presented: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new Error("Target 62 simulation was aborted"));
  }
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const abort = () => {
      rejectPromise(new Error("Target 62 simulation was aborted"));
    };
    signal.addEventListener("abort", abort, { once: true });
    presented.then(
      () => {
        signal.removeEventListener("abort", abort);
        resolvePromise();
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        rejectPromise(error);
      },
    );
  });
}

function captureSimulatorAction(
  action: Promise<void>,
): Promise<
  | { readonly status: "completed" }
  | { readonly error: unknown; readonly status: "failed" }
> {
  return action.then(
    () => ({ status: "completed" as const }),
    (error: unknown) => ({ error, status: "failed" as const }),
  );
}
