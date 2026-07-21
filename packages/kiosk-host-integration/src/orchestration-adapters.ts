import type { DepositHostPostingPort } from "@tripley-kit/web-container-deposit-orchestration";
import type { WithdrawalHostPostingPort } from "@tripley-kit/web-container-withdrawal-orchestration";

import type { DurableHostMessageExchange } from "./exchange";

type WithdrawalAuthorizeInput = Parameters<WithdrawalHostPostingPort["authorize"]>[0];
type WithdrawalAuthorizeResult = Awaited<ReturnType<WithdrawalHostPostingPort["authorize"]>>;
type WithdrawalCompleteInput = Parameters<NonNullable<WithdrawalHostPostingPort["complete"]>>[0];
type DepositAuthorizeInput = Parameters<DepositHostPostingPort["authorize"]>[0];
type DepositAuthorizeResult = Awaited<ReturnType<DepositHostPostingPort["authorize"]>>;
type DepositCompleteInput = Parameters<NonNullable<DepositHostPostingPort["complete"]>>[0];

export interface OrchestrationHostBindingOptions {
  readonly authorizationBindingId: string;
  readonly completionBindingId?: string | undefined;
}

export const createWithdrawalHostPostingAdapter = (
  exchange: DurableHostMessageExchange,
  bindings: OrchestrationHostBindingOptions,
): WithdrawalHostPostingPort => {
  const authorize = (request: WithdrawalAuthorizeInput) =>
    exchange.execute<WithdrawalAuthorizeInput, WithdrawalAuthorizeResult>({
      bindingId: bindings.authorizationBindingId,
      operationId: request.operationId,
      request,
    });
  const completionBindingId = bindings.completionBindingId;
  if (!completionBindingId) return { authorize };
  return {
    authorize,
    complete: async (request: WithdrawalCompleteInput) => {
      await exchange.execute<WithdrawalCompleteInput, void>({
        bindingId: completionBindingId,
        operationId: request.operationId,
        request,
      });
    },
  };
};

export const createDepositHostPostingAdapter = (
  exchange: DurableHostMessageExchange,
  bindings: OrchestrationHostBindingOptions,
): DepositHostPostingPort => {
  const authorize = (request: DepositAuthorizeInput) =>
    exchange.execute<DepositAuthorizeInput, DepositAuthorizeResult>({
      bindingId: bindings.authorizationBindingId,
      operationId: request.operationId,
      request,
    });
  const completionBindingId = bindings.completionBindingId;
  if (!completionBindingId) return { authorize };
  return {
    authorize,
    complete: async (request: DepositCompleteInput) => {
      await exchange.execute<DepositCompleteInput, void>({
        bindingId: completionBindingId,
        operationId: request.operationId,
        request,
      });
    },
  };
};
