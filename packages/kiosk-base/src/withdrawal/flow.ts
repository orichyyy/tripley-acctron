import {
  type FlowDefinition,
  type UserInputNodeDefinition,
  defineFlow,
  defineNode,
  defineUserInputNode,
} from "@tripley/web-container-flow-engine";

export const createWithdrawalExampleFlow = (): FlowDefinition =>
  defineFlow({
    id: "kiosk.withdrawal.example",
    nodes: {
      enterAmount: createEnterAmountNode(),
      enterPin: createEnterPinNode(),
      returnToIdle: defineNode({ id: "returnToIdle", kind: "terminal" }),
      submitWithdrawal: defineNode({ id: "submitWithdrawal", kind: "terminal" }),
    },
    policies: {
      interrupts: [
        {
          action: { reasonCode: "CARD.REMOVED", type: "cancelFlow" },
          eventTopic: "device.card.removed",
          id: "card.removed",
          priority: 100,
        },
      ],
      userInputTimeout: {
        onTimeout: { nodeId: "returnToIdle", type: "next" },
        timeoutMs: 30_000,
      },
    },
    startNodeId: "enterAmount",
    trace: { redactSecureInput: true, summaryOnly: true },
    version: "1.0.0",
  });

const createEnterAmountNode = (): UserInputNodeDefinition =>
  defineUserInputNode({
    id: "enterAmount",
    input: {
      profile: (ctx) => {
        const input = ctx.input as { accountType?: string };
        return {
          constraints:
            input.accountType === "checking"
              ? { maxLength: 4, minLength: 2 }
              : { maxLength: 6, minLength: 1 },
          errorMessageKeys: { minLength: "withdrawal.amount.invalid" },
          id: `withdrawal.amount.${input.accountType ?? "default"}`,
          promptKey: "withdrawal.amount.prompt",
          sourceOptions: {
            "barcodeReader.qr": { parseAs: "withdrawalQr" },
            "demo.input": { dataType: "numeric" },
          },
        };
      },
      sources: (profile, ctx) => [
        {
          id: "pinpadAmount",
          kind: "demo.input",
          options: {
            demoValue: (ctx.input as { demoValue?: string }).demoValue ?? "100",
            maxLength: profile.constraints?.maxLength,
            minLength: profile.constraints?.minLength,
          },
          required: true,
        },
        {
          enabledWhen: "features.withdrawal.qrInput.enabled",
          id: "mobileQr",
          kind: "barcodeReader.qr",
          required: false,
        },
      ],
      ui: { path: "/customer/withdrawal/amount", stateKey: "withdrawal.amount" },
      validation: {
        local: (result) => {
          const value = Number(result.value);
          return value > 0
            ? { valid: true, value }
            : {
                messageKey: "withdrawal.amount.invalid",
                reasonCode: "AMOUNT.INVALID",
                valid: false,
              };
        },
      },
    },
    kind: "userInput",
    next: "enterPin",
  });

const createEnterPinNode = (): UserInputNodeDefinition =>
  defineUserInputNode({
    id: "enterPin",
    input: {
      profile: {
        constraints: { maxLength: 12, minLength: 4 },
        id: "pin.secure",
        promptKey: "withdrawal.pin.prompt",
      },
      security: "secure",
      sources: [{ id: "pinpadPin", kind: "pinpad.pin", required: true, secure: true }],
      trace: { safeToLog: false, summaryOnly: true },
      ui: { path: "/customer/withdrawal/pin", stateKey: "withdrawal.pin" },
    },
    kind: "userInput",
  });
