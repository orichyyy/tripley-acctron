import type { BspV243PendingResponseInput } from "./contracts";
import {
  BSP_V243_IWD_BINDING_ID,
  BSP_V243_IWF_BINDING_ID,
} from "./withdrawal-host";

const responseBindings = new Map([
  ["IWD", BSP_V243_IWD_BINDING_ID],
  ["IWF", BSP_V243_IWF_BINDING_ID],
]);

export const resolveBspV243WithdrawalResponse = (
  input: BspV243PendingResponseInput,
): { readonly responseId?: string | undefined } | undefined => {
  const bindingId = responseBindings.get(input.code);
  if (!bindingId) return undefined;
  const bindingMarker = `:${bindingId}@`;
  return input.pending.idempotencyKey.includes(bindingMarker) ? {} : undefined;
};

