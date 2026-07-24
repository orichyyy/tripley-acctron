import type { BspV243PendingResponseInput } from "./contracts";
import {
  BSP_V243_IWD_BINDING_ID,
  BSP_V243_IWF_BINDING_ID,
} from "./withdrawal-host";
import {
  BSP_V243_IWD_RESPONSE_BYTES,
  BSP_V243_IWF_RESPONSE_BYTES,
} from "./withdrawal-profile";

const responseContracts = new Map([
  ["IWD", { bindingId: BSP_V243_IWD_BINDING_ID, bytes: BSP_V243_IWD_RESPONSE_BYTES }],
  ["IWF", { bindingId: BSP_V243_IWF_BINDING_ID, bytes: BSP_V243_IWF_RESPONSE_BYTES }],
]);

export const resolveBspV243WithdrawalResponse = (
  input: BspV243PendingResponseInput,
): { readonly responseId?: string | undefined } | undefined => {
  const contract = responseContracts.get(input.code);
  if (!contract || input.payload.length !== contract.bytes) {
    return undefined;
  }
  const bindingMarker = `:${contract.bindingId}@`;
  return input.pending.idempotencyKey.includes(bindingMarker) ? {} : undefined;
};
