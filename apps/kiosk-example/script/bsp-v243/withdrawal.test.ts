import { createHostMessageService } from "@tripley-kit/web-container-host-message";
import {
  type DurableHostMessageExchange,
  HostMessageBindingRegistry,
} from "@tripley-kit/web-container-kiosk-host-integration";
import type { WithdrawalOutcome } from "@tripley-kit/web-container-withdrawal-orchestration";
import { describe, expect, it, vi } from "vitest";

import type {
  BspV243CompletionExchangeRequest,
  BspV243IwdContext,
} from "./withdrawal-contracts";
import {
  BSP_V243_IWD_BINDING_ID,
  BSP_V243_IWF_BINDING_ID,
  createBspV243WithdrawalHostContribution,
} from "./withdrawal-host";
import {
  BSP_V243_IWD_RESPONSE_BYTES,
  BSP_V243_IWF_RESPONSE_BYTES,
  bspWithdrawalCompletionResponseLayout,
  bspV243WithdrawalProfile,
  bspWithdrawalResponseLayout,
} from "./withdrawal-profile";

describe("Taiwan BSP v2.43 withdrawal host integration", () => {
  it("packs 720-byte IWD/IWF requests and replies", () => {
    const messages = createHostMessageService({
      profiles: [bspV243WithdrawalProfile],
    }).service;
    const contribution = contributionFixture(true);
    const authorization = contribution.authorizationBinding.projectRequest({
      context: authorizationContext,
      input: authorizationInput,
    });
    const completion = contribution.completionBinding?.projectRequest({
      context: {
        ...authorizationContext,
        originalAtmSequence: "00000123",
        originalAtmSystemDate: "20260724",
      },
      input: completionInput,
    });

    expect(pack(messages, "iwd.request", authorization)).toHaveLength(720);
    expect(pack(messages, "iwf.request", completion ?? {})).toHaveLength(720);
    expect(pack(messages, "iwd.response", responseFields("IWD"))).toHaveLength(
      BSP_V243_IWD_RESPONSE_BYTES,
    );
    expect(pack(messages, "iwf.response", responseFields("IWF"))).toHaveLength(
      BSP_V243_IWF_RESPONSE_BYTES,
    );
  });

  it("maps authorization approval and decline using project reject codes", () => {
    const messages = createHostMessageService({
      profiles: [bspV243WithdrawalProfile],
    }).service;
    const binding = contributionFixture(false).authorizationBinding;
    const approved = unpack(messages, "iwd.response", responseFields("IWD"));
    const declined = unpack(
      messages,
      "iwd.response",
      responseFields("IWD", { outRejectCode: "9123" }),
    );

    expect(binding.mapResponse(approved)).toEqual({
      authorizationReference: "1234567",
      status: "approved",
    });
    expect(binding.mapResponse(declined)).toEqual({
      reasonCode: "9123",
      status: "declined",
    });
  });

  it("never includes account, PIN, track, TAC, or MAC values in safe summaries", () => {
    const messages = createHostMessageService({
      profiles: [bspV243WithdrawalProfile],
    }).service;
    const binding = contributionFixture(false).authorizationBinding;
    const fields = binding.projectRequest({
      context: authorizationContext,
      input: authorizationInput,
    });
    const bytes = pack(messages, "iwd.request", fields);
    const decoded = messages.unpack({
      bytes,
      reference: reference("iwd.request"),
    });
    if (decoded.status !== "complete") throw new Error("IWD fixture did not decode");

    const summaries = JSON.stringify({
      binding: binding.summarizeRequest({
        context: authorizationContext,
        input: authorizationInput,
      }),
      profile: messages.safeSummary(decoded.message),
    });
    for (const forbidden of [
      "6222021234567890",
      "1234567890123456",
      "0123456789ABCDEF",
      "TRACK3-SECRET",
      "TAC-SECRET",
      "MACVALUE",
    ]) {
      expect(summaries).not.toContain(forbidden);
    }
  });

  it("keeps Host Financial Completion optional while local finalization stays external", () => {
    const exchange = {
      execute: vi.fn(async () => ({ authorizationReference: "1234567", status: "approved" })),
    } as unknown as DurableHostMessageExchange;
    const contribution = contributionFixture(false);
    const registry = contribution.register(new HostMessageBindingRegistry());
    const port = contribution.createPostingPort(exchange);

    expect(contribution.completionBinding).toBeUndefined();
    expect(port.complete).toBeUndefined();
    expect(() => registry.require(BSP_V243_IWF_BINDING_ID)).toThrow();
  });

  it("projects original IWD references and project-defined failure evidence into IWF", async () => {
    const execute = vi.fn(
      async (_request: {
        bindingId: string;
        operationId: string;
        request: BspV243CompletionExchangeRequest;
      }) => undefined,
    );
    const exchange = { execute } as unknown as DurableHostMessageExchange;
    const contribution = contributionFixture(true);
    const port = contribution.createPostingPort(exchange);

    await port.complete?.(completionInput);
    const exchangeRequest = execute.mock.calls[0]?.[0];
    expect(exchangeRequest).toMatchObject({
      bindingId: BSP_V243_IWF_BINDING_ID,
      operationId: "withdrawal-1",
    });
    const request = exchangeRequest?.request as BspV243CompletionExchangeRequest;
    const fields = contribution.completionBinding?.projectRequest(request);
    expect(fields).toMatchObject({
      inExceptionKind: "C",
      inExceptionNumber: "101",
      inOriginalAtmSequence: "00000123",
      inOriginalAtmSystemDate: "20260724",
      inOriginalCenterSequence: "1234567",
      inTransactionCode: "IWF",
    });
  });

  it("registers IWD and IWF without modifying host integration core", () => {
    const contribution = contributionFixture(true);
    const registry = contribution.register(new HostMessageBindingRegistry()).freeze();
    expect(registry.require(BSP_V243_IWD_BINDING_ID)).toBe(
      contribution.authorizationBinding,
    );
    expect(registry.require(BSP_V243_IWF_BINDING_ID)).toBe(
      contribution.completionBinding,
    );
  });
});

const authorizationContext: BspV243IwdContext = {
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
    inChipTac: "TAC-SECRET",
    inCurrencyCode: "01",
    inMac: "MACVALUE",
    inPinBlock: "0123456789ABCDEF",
    inTrack3: "TRACK3-SECRET",
    inTransactionAccount: "1234567890123456",
    inTransactionAmount: "00001000",
  },
};

const authorizationInput = {
  amount: { currency: "TWD", minorUnits: 1000 },
  entryMode: "contact-card" as const,
  operationId: "withdrawal-1",
  protocol: {
    id: "taiwan.bsp",
    mode: "authorization-then-completion" as const,
    version: "2.43",
  },
};

const completionInput = {
  authorizationReference: "1234567",
  operationId: "withdrawal-1",
  outcome: {
    card: { required: true, status: "returned" },
    cash: {
      custody: "retracted",
      dispense: "completed",
      dispensed: true,
      present: "not-requested",
      presented: false,
      reconciliationRequired: false,
      retracted: true,
      taken: false,
    },
    entryMode: "contact-card",
    host: {
      authorizationReference: "1234567",
      protocolId: "taiwan.bsp",
      protocolMode: "authorization-then-completion",
      protocolVersion: "2.43",
      status: "approved",
    },
    kind: "withdrawal.outcome",
    operationId: "withdrawal-1",
    policyId: "withdrawal.tw",
    policyVersion: "1",
    reason: "verification-cancelled",
    safeSummary: { reason: "verification-cancelled" },
    status: "cancelled",
    trigger: "cancel",
  } satisfies WithdrawalOutcome,
  protocol: authorizationInput.protocol,
};

const contributionFixture = (withCompletion: boolean) =>
  createBspV243WithdrawalHostContribution({
    contexts: {
      authorization: async () => authorizationContext,
    },
    transportId: "native.tcp.bsp",
    ...(withCompletion
      ? {
          completion: {
            context: async () => ({
              ...authorizationContext,
              originalAtmSequence: "00000123",
              originalAtmSystemDate: "20260724",
            }),
            reasonPolicy: {
              map: (outcome: WithdrawalOutcome) =>
                outcome.reason === "verification-cancelled"
                  ? { kind: "C", number: "101" }
                  : { kind: "", number: "000" },
            },
          },
        }
      : {}),
  });

const reference = (messageId: string) => ({
  messageId,
  profileId: bspV243WithdrawalProfile.id,
  profileVersion: bspV243WithdrawalProfile.version,
});

const pack = (
  messages: ReturnType<typeof createHostMessageService>["service"],
  messageId: string,
  fields: Readonly<Record<string, unknown>>,
): Uint8Array => {
  const result = messages.pack({
    fields: fields as never,
    reference: reference(messageId),
  });
  if (result.status !== "packed") {
    throw new Error(`${result.error.code}:${result.error.fieldId ?? ""}`);
  }
  return result.message.bytes;
};

const unpack = (
  messages: ReturnType<typeof createHostMessageService>["service"],
  messageId: string,
  fields: Readonly<Record<string, string>>,
) => {
  const decoded = messages.unpack({
    bytes: pack(messages, messageId, fields),
    reference: reference(messageId),
  });
  if (decoded.status !== "complete") throw new Error("BSP fixture did not decode");
  return decoded.message.fields;
};

const responseFields = (
  code: "IWD" | "IWF",
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> => ({
  ...Object.fromEntries(
    (code === "IWD"
      ? bspWithdrawalResponseLayout
      : bspWithdrawalCompletionResponseLayout
    ).map(({ id }) => [id, ""]),
  ),
  outAtmId: "00001",
  outBusinessDate: "20260724",
  outCenterSequence: "1234567",
  outDate: "20260724",
  outSequence: "00000123",
  outSystemDate: "20260724",
  outTime: "120000",
  outTransactionCode: code,
  ...overrides,
});
