import type {
  HostFieldSet,
  HostMessageDefinition,
  HostMessageProfile,
  HostMessageService,
} from "@tripley-kit/web-container-host-message";
import type {
  DurableHostDeliveryBridge,
} from "@tripley-kit/web-container-kiosk-host-integration";
import type { HostTransportPort } from "@tripley-kit/web-container-kiosk-host-delivery";
import type { NativeTcpEvent } from "@tripley-kit/web-container-kiosk-host-native-channel";
import { describe, expect, it, vi } from "vitest";

import { bspV243Profile } from "./profile";
import {
  BSP_V243_IWD_BINDING_ID,
  BSP_V243_IWF_BINDING_ID,
} from "./withdrawal-host";
import {
  BSP_V243_IWD_RESPONSE_BYTES,
  BSP_V243_IWF_RESPONSE_BYTES,
  bspWithdrawalResponseLayout,
} from "./withdrawal-profile";
import {
  createBspV243WithdrawalHostRuntime,
} from "./withdrawal-runtime";
import { resolveBspV243WithdrawalResponse } from "./withdrawal-router";

describe("Taiwan BSP v2.43 withdrawal host runtime", () => {
  it("matches financial replies to the corresponding pending binding only", () => {
    const pending = (bindingId: string) => ({
      channel: "bsp.primary",
      idempotencyKey: `withdrawal-1:${bindingId}@1`,
    });

    expect(resolveBspV243WithdrawalResponse({
      code: "IWD",
      payload: new Uint8Array(BSP_V243_IWD_RESPONSE_BYTES),
      pending: pending(BSP_V243_IWD_BINDING_ID),
    })).toEqual({});
    expect(resolveBspV243WithdrawalResponse({
      code: "IWF",
      payload: new Uint8Array(BSP_V243_IWD_RESPONSE_BYTES),
      pending: pending(BSP_V243_IWD_BINDING_ID),
    })).toBeUndefined();
    expect(resolveBspV243WithdrawalResponse({
      code: "IWF",
      payload: new Uint8Array(BSP_V243_IWF_RESPONSE_BYTES),
      pending: pending(BSP_V243_IWF_BINDING_ID),
    })).toEqual({});
  });

  it("establishes OEX and executes durable IWD over one persistent session", async () => {
    const wireCodes: string[] = [];
    let eventHandler: ((event: NativeTcpEvent) => void) | undefined;
    let runtime: ReturnType<typeof createBspV243WithdrawalHostRuntime>;
    const close = vi.fn(async () => undefined);
    const tcp = {
      close,
      connect: vi.fn(async () => "socket-1"),
      end: vi.fn(async () => undefined),
      onEvent: (handler: (event: NativeTcpEvent) => void) => {
        eventHandler = handler;
        return { unsubscribe: vi.fn() };
      },
      write: vi.fn(async (socketId: string, framed: Uint8Array) => {
        const decoded = runtime.profile.frame.decode(framed);
        if (decoded.status !== "complete") throw new Error("BSP request frame is invalid");
        const code = ascii(decoded.payload, 2, 3);
        wireCodes.push(code);
        const response = code === "OEX"
          ? oexResponse(runtime.profile.messages)
          : withdrawalResponse(runtime.profile.messages);
        eventHandler?.({
          data: runtime.profile.frame.encode(response),
          id: socketId,
          kind: "data",
          message: null,
          parentId: null,
        });
      }),
    };
    runtime = createBspV243WithdrawalHostRuntime({
      createDelivery: inMemoryDelivery,
      host: "127.0.0.1",
      hostOptions: {
        contexts: {
          authorization: async () => authorizationContext,
        },
      },
      port: 12008,
      tcp,
      terminalState: async () => terminalSnapshot,
    });

    expect(await runtime.readyCondition.evaluate({} as never)).toMatchObject({
      allowed: false,
    });
    await within(
      runtime.start(),
      () => `runtime.start codes=${wireCodes.join(",")} state=${runtime.supervisor.snapshot.state}`,
    );
    expect(runtime.supervisor.snapshot).toMatchObject({
      available: true,
      state: "ready",
    });
    expect(await runtime.healthCheck.run()).toMatchObject({ status: "pass" });

    await expect(within(runtime.host.authorize({
      amount: { currency: "TWD", minorUnits: 1000 },
      entryMode: "contact-card",
      operationId: "withdrawal-1",
      protocol: {
        id: "taiwan.bsp",
        mode: "authorization-only",
        version: "2.43",
      },
    }), "host.authorize")).resolves.toEqual({
      authorizationReference: "1234567",
      status: "approved",
    });
    expect(wireCodes).toEqual(["OEX", "IWD"]);

    await within(runtime.dispose(), "runtime.dispose");
    expect(close).toHaveBeenCalledWith("socket-1");
  });
});

const authorizationContext = {
  header: {
    atmId: "00001",
    businessDate: "20260724",
    sequence: "00000123",
    systemDate: "20260724",
    versionDate: "20260206",
    versionMarker: "V",
  },
  ici: {
    inBankNumber: "807",
    inCardAccount: "6222021234567890",
    inCurrencyCode: "01",
    inPinBlock: "0123456789ABCDEF",
    inTransactionAccount: "1234567890123456",
    inTransactionAmount: "00001000",
  },
};

const terminalSnapshot = {
  atmId: "00001",
  businessDate: "20260724",
  sequence: "00000001",
  systemDate: "20260724",
  versionDate: "20260206",
};

const inMemoryDelivery = (
  transport: HostTransportPort,
): DurableHostDeliveryBridge => {
  let record: Record<string, unknown> | undefined;
  let response:
    | {
        payload: Uint8Array;
        responseId: string;
        safeSummary: Readonly<Record<string, string | number | boolean>>;
      }
    | undefined;
  return {
    enqueue: async (input) => {
      record ??= {
        ...input,
        attemptCount: 0,
        createdAt: "2026-07-24T00:00:00.000Z",
        policyVersion: "1",
        status: "pending",
        updatedAt: "2026-07-24T00:00:00.000Z",
      };
      return record as never;
    },
    get: async () => record as never,
    dispatch: async () => {
      if (!record || record.status === "reconciled") return;
      const result = await transport.send({
        ...record,
        outboxId: record.id,
      } as never);
      if (result.status !== "response") {
        record = {
          ...record,
          status: result.status === "unknown" ? "uncertain" : "retryScheduled",
        };
        return;
      }
      response = result;
      record = { ...record, responseId: result.responseId, status: "reconciled" };
    },
    readResponse: async () => response && record
      ? {
          ...response,
          createdAt: "2026-07-24T00:00:00.000Z",
          outboxId: String(record.id),
          payloadRef: "memory",
          source: "transport",
        }
      : undefined,
  };
};

const oexResponse = (messages: HostMessageService): Uint8Array => {
  const definition = requireMessage(bspV243Profile, "oex", "response");
  const fields = blankFields(bspV243Profile, definition);
  const first = definition.fields[0];
  if (!first || first.kind !== "field") throw new Error("OEX response code field is missing");
  fields[first.fieldId] = "OEX";
  fields.hostAtmId = "00001";
  return pack(messages, bspV243Profile, definition.id, fields);
};

const withdrawalResponse = (messages: HostMessageService): Uint8Array => {
  const fields: Record<string, string> = {
    ...Object.fromEntries(bspWithdrawalResponseLayout.map(({ id }) => [id, ""])),
    outAtmId: "00001",
    outBusinessDate: "20260724",
    outCenterSequence: "1234567",
    outDate: "20260724",
    outSequence: "00000123",
    outSystemDate: "20260724",
    outTime: "120000",
    outTransactionCode: "IWD",
  };
  return pack(
    messages,
    {
      id: "taiwan.bsp.v243.withdrawal",
      version: "2.43",
    },
    "iwd.response",
    fields,
  );
};

const blankFields = (
  profile: HostMessageProfile,
  message: HostMessageDefinition,
): Record<string, string> => Object.fromEntries(
  message.fields.flatMap((use) => {
    if (use.kind !== "field") return [];
    const field = profile.fieldDefinitions.find(({ id }) => id === use.fieldId);
    return field ? [[field.id, ""]] : [];
  }),
);

const requireMessage = (
  profile: HostMessageProfile,
  idPart: string,
  direction: HostMessageDefinition["direction"],
): HostMessageDefinition => {
  const message = profile.messages.find(
    (candidate) =>
      candidate.direction === direction &&
      candidate.id.toLowerCase().includes(idPart),
  );
  if (!message) throw new Error(`BSP message definition is missing: ${idPart}`);
  return message;
};

const pack = (
  messages: HostMessageService,
  profile: Pick<HostMessageProfile, "id" | "version">,
  messageId: string,
  fields: HostFieldSet,
): Uint8Array => {
  const result = messages.pack({
    fields,
    reference: {
      messageId,
      profileId: profile.id,
      profileVersion: profile.version,
    },
  });
  if (result.status !== "packed") {
    throw new Error(`${result.error.code}:${result.error.fieldId ?? ""}`);
  }
  return result.message.bytes;
};

const ascii = (bytes: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...bytes.slice(offset, offset + length));

const within = <T>(
  operation: Promise<T>,
  label: string | (() => string),
): Promise<T> =>
  Promise.race([
    operation,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        const description = typeof label === "string" ? label : label();
        reject(new Error(`${description} timed out`));
      }, 500);
    }),
  ]);
