import type { StepContext, StepHandler } from "@tripley-acctron/contracts";
import type { HostRequestStepDefinition, WaitDeviceStepDefinition } from "./step-kit-types";
import { routeFailedOrThrow } from "./step-kit-utils";

export function defineHostRequestStep<TResponse = unknown>(
  definition: HostRequestStepDefinition<TResponse>,
): StepHandler {
  return async (ctx) =>
    runCallbackStep(ctx, definition.request, definition.route, definition.routes?.failed);
}

export function defineWaitDeviceStep<TResponse = unknown>(
  definition: WaitDeviceStepDefinition<TResponse>,
): StepHandler {
  return async (ctx) =>
    runCallbackStep(ctx, definition.wait, definition.route, definition.routes?.failed);
}

async function runCallbackStep<TResponse>(
  ctx: StepContext,
  callback: (ctx: StepContext) => Promise<TResponse>,
  route: (response: TResponse, ctx: StepContext) => string,
  failedRoute: string | undefined,
) {
  try {
    const response = await ctx.scope.guard(callback(ctx));
    return ctx.next(route(response, ctx));
  } catch (error) {
    return routeFailedOrThrow(ctx, failedRoute, error);
  }
}
