import type { StepContext, TimeoutOptions } from "@tripley-acctron/contracts";
import type { DeviceWaitResult } from "./recipe-types";

export async function waitWithOptionalTimeout<T>(
  ctx: StepContext,
  wait: Promise<T>,
  timeout: TimeoutOptions | undefined,
): Promise<DeviceWaitResult<T>> {
  if (!timeout || !ctx.timeoutService) {
    return { type: "done", value: await ctx.scope.guard(wait) };
  }

  const handle = ctx.timeoutService.start({ ...timeout, signal: ctx.scope.signal });
  try {
    const result = await ctx.scope.race([wait.then(done), handle.result.then(timeoutDone)]);
    return result;
  } finally {
    handle.cancel();
  }
}

function done<T>(value: T): DeviceWaitResult<T> {
  return { type: "done", value };
}

function timeoutDone(): DeviceWaitResult<never> {
  return { type: "timeout" };
}
