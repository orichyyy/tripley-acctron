import type {
  InteractionReducerContext,
  InteractionReducerResult,
} from "@tripley-acctron/contracts";

export function createInteractionReducerContext<TState, TAccepted>(): InteractionReducerContext<
  TState,
  TAccepted
> {
  return {
    accept: (value) => ({ type: "accepted", value }),
    cancel: () => ({ type: "cancelled" }),
    timeout: () => ({ type: "timeout" }),
    fail: (error) => ({ type: "failed", error }),
    update: (state) => ({ type: "state", state }),
  };
}

export function isTerminalInteractionResult<TState, TAccepted>(
  result: InteractionReducerResult<TState, TAccepted>,
): result is Exclude<InteractionReducerResult<TState, TAccepted>, { type: "state" }> {
  return result.type !== "state";
}
