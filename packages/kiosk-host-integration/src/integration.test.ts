import {
  type HostFieldSet,
  createHostMessageService,
} from "@tripley-kit/web-container-host-message";
import { describe, expect, it, vi } from "vitest";

import { HostMessageBindingRegistry } from "./binding-registry";
import type { DurableHostDeliveryBridge, HostMessageBinding } from "./contracts";
import { DurableHostMessageExchange } from "./exchange";
import { HostMessageTransportAdapter } from "./message-transport";
import {
  createDepositHostPostingAdapter,
  createWithdrawalHostPostingAdapter,
} from "./orchestration-adapters";
import { fixedExchangeProfile, isoExchangeProfile } from "./test-profiles";
import { HostWireTransportRegistry } from "./transport-registry";

describe("host message durable integration", () => {
  it.each([
    ["fixed", fixedBinding()],
    ["iso8583", isoBinding()],
  ])("packs and unpacks a %s exchange through a registered transport", async (_name, binding) => {
    const messages = createHostMessageService({
      profiles: [fixedExchangeProfile, isoExchangeProfile],
    }).service;
    const response = messages.pack({
      fields: { authorizationReference: "AUTH01", responseCode: "00" },
      reference: binding.response,
    });
    if (response.status !== "packed") throw new Error("response fixture failed");
    const wire = vi.fn(async () => ({
      payload: response.message.bytes,
      responseId: "response-1",
      status: "response" as const,
    }));
    const bindings = new HostMessageBindingRegistry().register(binding);
    const transport = new HostMessageTransportAdapter({
      bindings,
      messages,
      transports: new HostWireTransportRegistry().register({ exchange: wire, id: "test" }),
    });
    const delivery = inMemoryDelivery(transport);
    const exchange = new DurableHostMessageExchange({ bindings, delivery, messages });

    await expect(
      exchange.execute({
        bindingId: binding.id,
        operationId: `operation-${_name}`,
        request:
          binding.id === "fixed.authorization"
            ? { pan: "6222020000000001", pinBlock: "PINBLOCK" }
            : { stan: "000001" },
      }),
    ).resolves.toEqual({ authorizationReference: "AUTH01", status: "approved" });
    expect(delivery.requestSummary).toEqual({ operationType: "withdrawal" });
    expect(JSON.stringify(delivery.requestSummary)).not.toContain("PINBLOCK");
    expect(JSON.stringify(delivery.requestSummary)).not.toContain("6222020000000001");
  });

  it("reuses a reconciled response without sending the request again", async () => {
    const binding = fixedBinding();
    const messages = createHostMessageService({ profiles: [fixedExchangeProfile] }).service;
    const response = messages.pack({
      fields: { authorizationReference: "AUTH01", responseCode: "00" },
      reference: binding.response,
    });
    if (response.status !== "packed") throw new Error("response fixture failed");
    const wire = vi.fn(async () => ({
      payload: response.message.bytes,
      responseId: "r1",
      status: "response" as const,
    }));
    const bindings = new HostMessageBindingRegistry().register(binding);
    const delivery = inMemoryDelivery(
      new HostMessageTransportAdapter({
        bindings,
        messages,
        transports: new HostWireTransportRegistry().register({ exchange: wire, id: "test" }),
      }),
    );
    const exchange = new DurableHostMessageExchange({ bindings, delivery, messages });
    await exchange.execute({
      bindingId: binding.id,
      operationId: "same-operation",
      request: { pan: "6222020000000001", pinBlock: "12345678" },
    });
    await exchange.execute({
      bindingId: binding.id,
      operationId: "same-operation",
      request: { pan: "destroyed", pinBlock: "destroyed" },
    });
    expect(wire).toHaveBeenCalledTimes(1);
  });

  it("supplies withdrawal and deposit ports while completion remains optional", async () => {
    const execute = vi.fn(async (input: { bindingId: string }) =>
      input.bindingId.startsWith("deposit")
        ? { approved: true, operationId: "deposit-1", revision: 1, snapshotHash: "hash" }
        : { status: "approved" },
    );
    const exchange = { execute } as unknown as DurableHostMessageExchange;
    const withdrawal = createWithdrawalHostPostingAdapter(exchange, {
      authorizationBindingId: "withdrawal.authorization",
    });
    const deposit = createDepositHostPostingAdapter(exchange, {
      authorizationBindingId: "deposit.authorization",
    });

    expect(withdrawal.complete).toBeUndefined();
    expect(deposit.complete).toBeUndefined();
    await expect(withdrawal.authorize(withdrawalRequest())).resolves.toEqual({
      status: "approved",
    });
    await expect(deposit.authorize(depositRequest())).resolves.toMatchObject({ approved: true });
  });

  it("accepts a custom transport plugin without changing core", () => {
    const custom = { exchange: vi.fn(), id: "bank.custom-nfc-host" };
    const registry = new HostWireTransportRegistry().register(custom).freeze();
    expect(registry.require(custom.id)).toBe(custom);
  });

  it("preserves an unknown delivery as an uncertain business failure", async () => {
    const binding = fixedBinding();
    const messages = createHostMessageService({ profiles: [fixedExchangeProfile] }).service;
    const bindings = new HostMessageBindingRegistry().register(binding);
    const delivery = inMemoryDelivery(
      new HostMessageTransportAdapter({
        bindings,
        messages,
        transports: new HostWireTransportRegistry().register({
          exchange: async () => ({ errorCode: "network.disconnected", status: "unknown" }),
          id: "test",
        }),
      }),
    );
    const exchange = new DurableHostMessageExchange({ bindings, delivery, messages });

    await expect(
      exchange.execute({
        bindingId: binding.id,
        operationId: "uncertain-operation",
        request: { pan: "6222020000000001", pinBlock: "12345678" },
      }),
    ).rejects.toMatchObject({ code: "host.exchange.uncertain", kind: "delivery" });
  });
});

const fixedBinding = (): HostMessageBinding<
  Record<string, string>,
  { status: "approved"; authorizationReference: string }
> => ({
  channel: "fixed",
  deliveryPolicyId: "authorization.standard",
  id: "fixed.authorization",
  mapResponse: approval,
  messageType: "fixed.authorization",
  projectRequest: (input) => ({
    messageType: "01",
    pan: input.pan ?? "",
    pinBlock: input.pinBlock ?? "",
  }),
  request: { messageId: "authorization.request", profileId: "target51.fixed", profileVersion: "1" },
  response: {
    messageId: "authorization.response",
    profileId: "target51.fixed",
    profileVersion: "1",
  },
  summarizeRequest: () => ({ operationType: "withdrawal" }),
  timeoutMs: 5_000,
  transportId: "test",
  version: "1",
});

const isoBinding = (): HostMessageBinding<
  Record<string, string>,
  { status: "approved"; authorizationReference: string }
> => ({
  ...fixedBinding(),
  channel: "iso8583",
  id: "iso.authorization",
  messageType: "iso.authorization",
  projectRequest: (input) => ({ stan: input.stan ?? "" }),
  request: { messageId: "authorization.request", profileId: "target51.iso", profileVersion: "1" },
  response: { messageId: "authorization.response", profileId: "target51.iso", profileVersion: "1" },
});

const approval = (fields: HostFieldSet) => ({
  authorizationReference: fields.authorizationReference as string,
  status: "approved" as const,
});

const inMemoryDelivery = (transport: HostMessageTransportAdapter) => {
  let record: Record<string, unknown> | undefined;
  let response:
    | {
        payload: Uint8Array;
        responseId: string;
        safeSummary: Record<string, string | number | boolean>;
        source: "transport";
      }
    | undefined;
  const bridge: DurableHostDeliveryBridge & {
    requestSummary?: Record<string, string | number | boolean>;
  } = {
    async dispatch() {
      if (record?.status === "reconciled") return;
      const result = await transport.send(record as never);
      if (result.status !== "response") {
        record = {
          ...record,
          status: result.status === "unknown" ? "uncertain" : "retryScheduled",
        };
        return;
      }
      response = { ...result, source: "transport" };
      record = { ...record, responseId: result.responseId, status: "reconciled" };
    },
    async enqueue(input) {
      if (!record) record = { ...input, status: "pending" };
      bridge.requestSummary = input.safeSummary;
      return record as never;
    },
    async get() {
      return record as never;
    },
    async readResponse() {
      return response
        ? {
            ...response,
            createdAt: "2026-07-21T00:00:00.000Z",
            outboxId: String(record?.id),
            payloadRef: "memory",
          }
        : undefined;
    },
  };
  return bridge;
};

const withdrawalRequest = () => ({
  amount: { currency: "USD", minorUnits: 100 },
  entryMode: "cardless-reservation" as const,
  operationId: "withdrawal-1",
  protocol: { id: "host", mode: "authorization-only" as const, version: "1" },
});

const depositRequest = () => ({
  operationId: "deposit-1",
  protocol: { id: "host", mode: "authorization-only" as const, version: "1" },
  snapshot: { capturedAt: "now", hash: "hash", notes: [], refusedCount: 0, revision: 1 },
});
