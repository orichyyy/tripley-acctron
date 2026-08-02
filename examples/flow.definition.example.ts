import {
  type FlowExecutionContext,
  defineFlow,
  defineNode,
  defineUserInputNode,
} from "@tripley-kit/web-container-flow-engine";

export interface WithdrawalFlowInput {
  readonly accountId: string;
  readonly approve?: boolean | undefined;
}

export interface WithdrawalFlowOutput {
  readonly status: "approved" | "rejected" | "timedOut";
  readonly amount?: number | undefined;
  readonly authorizationCode?: string | undefined;
}

interface AuthorizationResult {
  readonly amount: number;
  readonly approved: boolean;
  readonly authorizationCode?: string | undefined;
}

export const withdrawalFlow = defineFlow<WithdrawalFlowInput, WithdrawalFlowOutput>({
  id: "kiosk.withdrawal",
  version: "1.0.0",
  description: "Collect an amount and PIN, then route the authorization result.",
  startNodeId: "enterAmount",
  timeoutMs: 120_000,
  retry: { maxAttempts: 2, backoffMs: 250 },
  policies: {
    userInputTimeout: {
      timeoutMs: 30_000,
      onTimeout: { type: "next", nodeId: "timedOut" },
    },
    interrupts: [
      {
        id: "card.removed",
        priority: 100,
        eventTopic: "device.card.removed",
        action: { type: "cancelFlow", reasonCode: "CARD.REMOVED" },
      },
    ],
  },
  nodes: {
    enterAmount: defineUserInputNode({
      id: "enterAmount",
      kind: "userInput",
      input: {
        semantic: "amount",
        security: "plain",
        profile: {
          id: "withdrawal.amount",
          promptKey: "withdrawal.amount.prompt",
          constraints: { inputMode: "decimal", minLength: 1, maxLength: 10 },
        },
        ui: {
          path: "/withdrawal/amount",
          stateKey: "withdrawal.amountInput",
          promptKey: "withdrawal.amount.prompt",
        },
        sources: [
          {
            id: "pinpad",
            kind: "pinpad.data",
            required: true,
            options: { dataType: "numeric", minLength: 1, maxLength: 10 },
          },
          {
            id: "screenCommand",
            kind: "ui.command",
            required: false,
            options: { commandId: "withdrawal.amount.confirmed" },
          },
        ],
        acceptance: { mode: "race", firstValidWins: true },
        validation: {
          local: (result) => {
            const amount = Number(result.value);
            return Number.isFinite(amount) && amount > 0
              ? { valid: true, value: amount, safeSummary: { amount } }
              : {
                  valid: false,
                  reasonCode: "AMOUNT.INVALID",
                  messageKey: "withdrawal.amount.invalid",
                  severity: "error",
                };
          },
          failure: { mode: "stayOnNode", maxAttempts: 3 },
        },
      },
      next: "enterPin",
    }),

    enterPin: defineUserInputNode({
      id: "enterPin",
      kind: "userInput",
      input: {
        semantic: "pin",
        security: "secure",
        profile: {
          id: "withdrawal.pin",
          promptKey: "withdrawal.pin.prompt",
          constraints: { inputMode: "numeric", minLength: 4, maxLength: 12 },
        },
        ui: {
          path: "/auth/pin",
          stateKey: "auth.pinInput",
          promptKey: "auth.pin.prompt",
        },
        sources: [
          {
            id: "pinpad",
            kind: "pinpad.pin",
            required: true,
            secure: true,
            options: {
              minLength: 4,
              maxLength: 12,
              pinBlockFormat: "ISO9564-0",
              keySlot: "bank.default",
            },
          },
        ],
        acceptance: { mode: "single" },
        cleanup: { cancelDevicesOnExit: true },
        trace: { safeToLog: false, summaryOnly: true },
      },
      next: "authorize",
    }),

    authorize: defineNode({
      id: "authorize",
      kind: "action",
      timeoutMs: 10_000,
      next: "routeAuthorization",
      run: async (ctx) => authorizeWithdrawal(ctx),
    }),

    routeAuthorization: defineNode({
      id: "routeAuthorization",
      kind: "decision",
      decide: (ctx) =>
        flowValue<AuthorizationResult>(ctx, "node.authorize.output").approved
          ? "approved"
          : "rejected",
    }),

    approved: defineNode({
      id: "approved",
      kind: "terminal",
      output: (ctx: FlowExecutionContext): WithdrawalFlowOutput => {
        const authorization = flowValue<AuthorizationResult>(ctx, "node.authorize.output");
        return {
          status: "approved",
          amount: authorization.amount,
          authorizationCode: authorization.authorizationCode,
        };
      },
    }),

    rejected: defineNode({
      id: "rejected",
      kind: "terminal",
      output: (ctx: FlowExecutionContext): WithdrawalFlowOutput => ({
        status: "rejected",
        amount: flowValue<AuthorizationResult>(ctx, "node.authorize.output").amount,
      }),
    }),

    timedOut: defineNode({
      id: "timedOut",
      kind: "terminal",
      output: { status: "timedOut" } satisfies WithdrawalFlowOutput,
    }),
  },
  edges: [
    { from: "routeAuthorization", branch: "approved", to: "approved" },
    { from: "routeAuthorization", branch: "rejected", to: "rejected" },
  ],
  catch: (_ctx, error) => ({ type: "fail", error }),
  finally: async (ctx) => {
    await ctx.scopedStore.clearScope("flow", ctx.instanceId, "withdrawal.finished");
  },
});

const authorizeWithdrawal = async (ctx: FlowExecutionContext): Promise<AuthorizationResult> => {
  const amount = flowValue<number>(ctx, "node.enterAmount.output");
  const input = ctx.input as WithdrawalFlowInput;

  // Replace this deterministic example with an injected host-service call.
  return input.approve === false
    ? { amount, approved: false }
    : { amount, approved: true, authorizationCode: `DEMO-${input.accountId}` };
};

const flowValue = <T>(ctx: FlowExecutionContext, key: string): T =>
  ctx.scopedStore.scope("flow", ctx.instanceId).getOrThrow<T>(key);
