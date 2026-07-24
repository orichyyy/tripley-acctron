import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type {
  DurableHostDeliveryBridge,
} from "@tripley-kit/web-container-kiosk-host-integration";
import type {
  HostDeliveryRecord,
  HostTransportPort,
} from "@tripley-kit/web-container-kiosk-host-delivery";
import type { NativeTcpApi } from "@tripley-kit/web-container-kiosk-host-native-channel";
import type { WithdrawalOutcome } from "@tripley-kit/web-container-withdrawal-orchestration";
import { describe, expect, it } from "vitest";

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

const smoke = process.env.BSP_V243_SIMULATOR_SMOKE === "1" ? it : it.skip;

describe("Taiwan BSP v2.43 real host simulator smoke", () => {
  smoke("executes OEX, IWD, and IWF through hostd", async () => {
    const native = await createNative();
    let connected = false;
    const runtime = createBspV243WithdrawalHostRuntime({
      createDelivery: createMemoryDelivery,
      host: process.env.BSP_V243_SIMULATOR_HOST ?? "127.0.0.1",
      hostOptions: {
        authorizationDeliveryPolicyId: "acctron.host.authorization",
        completion: {
          context: async () => ({
            ...withdrawalContext,
            originalAtmSequence: withdrawalContext.header.sequence,
            originalAtmSystemDate: withdrawalContext.header.systemDate,
          }),
          deliveryPolicyId: "acctron.host.financial-completion",
          reasonPolicy: {
            map: () => ({ kind: "", number: "000" }),
          },
        },
        contexts: {
          authorization: async () => withdrawalContext,
        },
      },
      port: numberFromEnvironment("BSP_V243_SIMULATOR_PORT", 12008),
      tcp: native.tcp,
      terminalState: async () => terminalSnapshot,
    });

    try {
      await native.connect();
      connected = true;
      await runtime.start();
      if (!runtime.supervisor.snapshot.available) {
        const snapshot = runtime.supervisor.snapshot;
        throw new Error(
          `BSP session not ready: state=${snapshot.state}, generation=${snapshot.generation}, reason=${snapshot.reasonCode ?? "none"}`,
        );
      }

      const authorization = await runtime.host.authorize(authorizationInput);
      expect(authorization.status).toBe("approved");
      expect(authorization.authorizationReference).toMatch(/^\d{7}$/);

      if (!runtime.host.complete) {
        throw new Error("BSP simulator smoke requires IWF completion");
      }
      await runtime.host.complete({
        authorizationReference: authorization.authorizationReference,
        operationId: authorizationInput.operationId,
        outcome: successfulOutcome(authorization.authorizationReference),
        protocol: authorizationInput.protocol,
      });
      expect(await runtime.healthCheck.run()).toMatchObject({ status: "pass" });

      process.stdout.write(`${JSON.stringify({
        authorization: "approved",
        event: "target58.bsp-v243-withdrawal.passed",
        financialCompletion: "accepted",
        generation: runtime.supervisor.snapshot.generation,
        sessionState: runtime.supervisor.snapshot.state,
        transport: "persistent-native-tcp",
      })}\n`);
    } finally {
      await runtime.dispose();
      if (connected) await native.dispose();
    }
  }, 45_000);
});

const createNative = async (): Promise<SmokeNative> => {
  const nativeDist = resolve(
    process.env.TRIPLEY_NATIVE_DIST ??
      "../../front-end/tripley-kit/libs/native/dist/index.js",
  );
  const moduleUrl = pathToFileURL(nativeDist).href;
  const nativeModule = await import(/* @vite-ignore */ moduleUrl) as NativeModule;
  return nativeModule.createWebSocketTripleyNative({
    requiredServices: ["runtime", "tcp"],
    url: `ws://127.0.0.1:${numberFromEnvironment("BSP_V243_HOSTD_PORT", 39013)}`,
  });
};

const createMemoryDelivery = (
  transport: HostTransportPort,
): DurableHostDeliveryBridge => {
  const records = new Map<string, HostDeliveryRecord>();
  const responses = new Map<string, {
    readonly responseId: string;
    readonly payload: Uint8Array;
    readonly safeSummary: Readonly<Record<string, string | number | boolean>>;
  }>();
  return {
    enqueue: async (input) => {
      const existing = records.get(input.id);
      if (existing) return existing;
      const { payload, ...metadata } = input;
      payloads.set(input.id, payload);
      const now = new Date().toISOString();
      const record: HostDeliveryRecord = {
        ...metadata,
        attemptCount: 0,
        createdAt: now,
        payloadRef: `${input.id}:request`,
        policyVersion: "1",
        status: "pending",
        updatedAt: now,
      };
      records.set(record.id, record);
      return record;
    },
    get: async (outboxId) => records.get(outboxId),
    dispatch: async (outboxId) => {
      const record = records.get(outboxId);
      if (!record || record.status === "reconciled") return;
      const result = await transport.send({
        channel: record.channel,
        idempotencyKey: record.idempotencyKey,
        messageId: record.messageId,
        messageType: record.messageType,
        outboxId,
        payload: await requirePayload(record),
        transactionId: record.transactionId,
      });
      if (result.status !== "response") {
        records.set(outboxId, {
          ...record,
          lastErrorCode: result.errorCode,
          status: result.status === "unknown" ? "uncertain" : "retryScheduled",
        });
        return;
      }
      responses.set(outboxId, result);
      records.set(outboxId, {
        ...record,
        responseId: result.responseId,
        status: "reconciled",
      });
    },
    readResponse: async (outboxId) => {
      const response = responses.get(outboxId);
      return response
        ? {
            ...response,
            createdAt: new Date().toISOString(),
            outboxId,
            payloadRef: `${outboxId}:response`,
            source: "transport",
          }
        : undefined;
    },
  };
};

const payloads = new Map<string, Uint8Array>();

const requirePayload = async (record: HostDeliveryRecord): Promise<Uint8Array> => {
  const payload = payloads.get(record.id);
  if (!payload) throw new Error(`Smoke delivery payload is missing: ${record.id}`);
  return payload;
};

const withdrawalContext = {
  header: {
    atmId: process.env.BSP_V243_ATM_ID ?? "00000",
    businessDate: process.env.BSP_V243_BUSINESS_DATE ?? "01150724",
    sequence: process.env.BSP_V243_WITHDRAWAL_SEQUENCE ?? "00000176",
    systemDate: process.env.BSP_V243_SYSTEM_DATE ?? "01150724",
    versionDate: process.env.BSP_V243_VERSION_DATE ?? "20260723",
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
    inTransactionAmount: "00001000",
  },
};

const terminalSnapshot = {
  atmId: withdrawalContext.header.atmId,
  businessDate: withdrawalContext.header.businessDate,
  depositMode: process.env.BSP_V243_DEPOSIT_MODE ?? "6",
  deviceStatus: process.env.BSP_V243_DEVICE_STATUS ?? "000000030000",
  mode: process.env.BSP_V243_ATM_MODE ?? "1",
  sequence: process.env.BSP_V243_OEX_SEQUENCE ?? "00000175",
  serviceStatus: process.env.BSP_V243_SERVICE_STATUS ?? "1",
  systemDate: withdrawalContext.header.systemDate,
  versionDate: withdrawalContext.header.versionDate,
};

const authorizationInput = {
  amount: { currency: "TWD", minorUnits: 1000 },
  entryMode: "contact-card" as const,
  operationId: `target58-${Date.now()}`,
  protocol: {
    id: "taiwan.bsp",
    mode: "authorization-then-completion" as const,
    version: "2.43",
  },
};

const successfulOutcome = (
  authorizationReference: string | undefined,
): WithdrawalOutcome => ({
  card: { required: true, status: "returned" },
  cash: {
    custody: "taken",
    dispense: "completed",
    dispensed: true,
    present: "completed",
    presented: true,
    reconciliationRequired: false,
    retracted: false,
    taken: true,
  },
  entryMode: "contact-card",
  host: {
    ...(authorizationReference ? { authorizationReference } : {}),
    protocolId: "taiwan.bsp",
    protocolMode: "authorization-then-completion",
    protocolVersion: "2.43",
    status: "approved",
  },
  kind: "withdrawal.outcome",
  operationId: authorizationInput.operationId,
  policyId: "withdrawal.tw",
  policyVersion: "1",
  reason: "completed",
  safeSummary: { result: "completed" },
  status: "completed",
});

const numberFromEnvironment = (name: string, fallback: number): number => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
    throw new Error(`Environment value is not a valid port: ${name}`);
  }
  return value;
};
