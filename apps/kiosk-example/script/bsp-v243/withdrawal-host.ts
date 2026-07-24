import type { HostFieldSet } from "@tripley-kit/web-container-host-message";
import {
  type HostMessageBinding,
  HostMessageBindingRegistry,
  type DurableHostMessageExchange,
} from "@tripley-kit/web-container-kiosk-host-integration";
import type {
  WithdrawalHostAuthorizationResult,
  WithdrawalHostPostingPort,
} from "@tripley-kit/web-container-withdrawal-orchestration";

import type {
  BspV243AuthorizationExchangeRequest,
  BspV243CompletionExchangeRequest,
  BspV243WithdrawalHostOptions,
} from "./withdrawal-contracts";
import {
  BSP_V243_WITHDRAWAL_PROFILE_ID,
  BSP_V243_WITHDRAWAL_PROFILE_VERSION,
} from "./withdrawal-profile";
import {
  projectBspV243IwdRequest,
  projectBspV243IwfRequest,
} from "./withdrawal-projector";

export const BSP_V243_IWD_BINDING_ID = "taiwan.bsp.v243.withdrawal.authorization";
export const BSP_V243_IWF_BINDING_ID = "taiwan.bsp.v243.withdrawal.completion";

const reference = (messageId: string) => ({
  messageId,
  profileId: BSP_V243_WITHDRAWAL_PROFILE_ID,
  profileVersion: BSP_V243_WITHDRAWAL_PROFILE_VERSION,
});

export interface BspV243WithdrawalHostContribution {
  readonly authorizationBinding: HostMessageBinding<
    BspV243AuthorizationExchangeRequest,
    WithdrawalHostAuthorizationResult
  >;
  readonly completionBinding?: HostMessageBinding<
    BspV243CompletionExchangeRequest,
    void
  >;
  register(registry: HostMessageBindingRegistry): HostMessageBindingRegistry;
  createPostingPort(exchange: DurableHostMessageExchange): WithdrawalHostPostingPort;
}

export const createBspV243WithdrawalHostContribution = (
  options: BspV243WithdrawalHostOptions,
): BspV243WithdrawalHostContribution => {
  const accepted = new Set(options.acceptedRejectCodes ?? [""]);
  const authorizationBinding = createAuthorizationBinding(options, accepted);
  const completionBinding = options.completion
    ? createCompletionBinding(options, accepted)
    : undefined;

  return {
    authorizationBinding,
    ...(completionBinding ? { completionBinding } : {}),
    register: (registry) => {
      registry.register(authorizationBinding);
      if (completionBinding) registry.register(completionBinding);
      return registry;
    },
    createPostingPort: (exchange) => createPostingPort(
      exchange,
      options,
      completionBinding !== undefined,
    ),
  };
};

const createAuthorizationBinding = (
  options: BspV243WithdrawalHostOptions,
  accepted: ReadonlySet<string>,
): HostMessageBinding<
  BspV243AuthorizationExchangeRequest,
  WithdrawalHostAuthorizationResult
> => ({
  channel: options.channel ?? "bsp.primary",
  deliveryPolicyId:
    options.authorizationDeliveryPolicyId ?? "withdrawal.authorization",
  id: BSP_V243_IWD_BINDING_ID,
  mapResponse: (fields) => mapAuthorization(fields, accepted),
  messageType: "bsp.iwd",
  projectRequest: ({ context }) => projectBspV243IwdRequest(context),
  request: reference("iwd.request"),
  response: reference("iwd.response"),
  summarizeRequest: ({ input, context }) => ({
    atmId: context.header.atmId,
    currency: input.amount.currency,
    entryMode: input.entryMode,
    minorUnits: input.amount.minorUnits,
    operationId: input.operationId,
    transactionCode: "IWD",
  }),
  timeoutMs: options.authorizationTimeoutMs ?? 30_000,
  transportId: options.transportId,
  version: "1",
});

const createCompletionBinding = (
  options: BspV243WithdrawalHostOptions,
  accepted: ReadonlySet<string>,
): HostMessageBinding<BspV243CompletionExchangeRequest, void> => {
  const completion = options.completion;
  if (!completion) throw new Error("BSP completion configuration is required");
  return {
    channel: options.channel ?? "bsp.primary",
    deliveryPolicyId: completion.deliveryPolicyId ?? "withdrawal.completion",
    id: BSP_V243_IWF_BINDING_ID,
    mapResponse: (fields) => {
      const rejectCode = text(fields, "outRejectCode");
      if (!accepted.has(rejectCode)) {
        throw new Error(`BSP IWF was rejected by host: ${rejectCode}`);
      }
    },
    messageType: "bsp.iwf",
    projectRequest: ({ context, input }) =>
      projectBspV243IwfRequest(
        context,
        input.authorizationReference ?? "",
        completion.reasonPolicy.map(input.outcome),
      ),
    request: reference("iwf.request"),
    response: reference("iwf.response"),
    summarizeRequest: ({ context, input }) => ({
      atmId: context.header.atmId,
      cashCustody: input.outcome.cash.custody,
      cashDispensed: input.outcome.cash.dispensed,
      cashPresented: input.outcome.cash.presented,
      cashRetracted: input.outcome.cash.retracted,
      cashTaken: input.outcome.cash.taken,
      operationId: input.operationId,
      outcomeReason: input.outcome.reason,
      outcomeStatus: input.outcome.status,
      transactionCode: "IWF",
    }),
    timeoutMs: completion.timeoutMs ?? 30_000,
    transportId: options.transportId,
    version: "1",
  };
};

const createPostingPort = (
  exchange: DurableHostMessageExchange,
  options: BspV243WithdrawalHostOptions,
  completionEnabled: boolean,
): WithdrawalHostPostingPort => {
  const authorize: WithdrawalHostPostingPort["authorize"] = async (input) =>
    exchange.execute({
      bindingId: BSP_V243_IWD_BINDING_ID,
      operationId: input.operationId,
      request: {
        context: await options.contexts.authorization(input),
        input,
      } satisfies BspV243AuthorizationExchangeRequest,
    });
  const completion = options.completion;
  if (!completionEnabled || !completion) return { authorize };
  return {
    authorize,
    complete: async (input) => {
      await exchange.execute({
        bindingId: BSP_V243_IWF_BINDING_ID,
        operationId: input.operationId,
        request: {
          context: await completion.context(input),
          input,
        } satisfies BspV243CompletionExchangeRequest,
      });
    },
  };
};

const mapAuthorization = (
  fields: HostFieldSet,
  accepted: ReadonlySet<string>,
): WithdrawalHostAuthorizationResult => {
  const reasonCode = text(fields, "outRejectCode");
  const authorizationReference = text(fields, "outCenterSequence");
  if (!accepted.has(reasonCode)) {
    return { reasonCode, status: "declined" };
  }
  return {
    status: "approved",
    ...(authorizationReference ? { authorizationReference } : {}),
  };
};

const text = (fields: HostFieldSet, id: string): string => {
  const value = fields[id];
  if (typeof value !== "string") throw new Error(`BSP response field is invalid: ${id}`);
  return value;
};
