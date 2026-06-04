import {
  KioskError,
  type HostResponse,
  type HostSendOptions,
  type StepContext,
  type StepHandler,
} from "@tripley-acctron/contracts";
import type { HostRequestStepDefinition, WaitDeviceStepDefinition } from "./step-kit-types";
import { routeFailedOrThrow } from "./step-kit-utils";

export function defineHostRequestStep<TResponse = unknown>(
  definition: HostRequestStepDefinition<TResponse>,
): StepHandler {
  return async (ctx) => {
    if ("request" in definition) {
      return runCallbackStep(ctx, definition.request, definition.route, definition.routes?.failed);
    }
    return runCallbackStep(
      ctx,
      (stepCtx) => requestHost(stepCtx, definition),
      definition.route,
      definition.routes?.failed,
    );
  };
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

async function requestHost<TResponse>(
  ctx: StepContext,
  definition: Exclude<HostRequestStepDefinition<TResponse>, { request: unknown }>,
): Promise<HostResponse<TResponse>> {
  if (!ctx.host) {
    throw new KioskError("host.missing", `Step ${definition.id} requires HostGateway.`);
  }

  const body = typeof definition.body === "function" ? definition.body(ctx) : definition.body;
  const traceId =
    typeof definition.traceId === "function" ? definition.traceId(ctx) : definition.traceId;
  const options: HostSendOptions = { signal: ctx.scope.signal };
  if (definition.timeoutMs !== undefined) {
    options.timeoutMs = definition.timeoutMs;
  }
  if (traceId !== undefined) {
    options.traceId = traceId;
  }
  return ctx.host.request({ messageType: definition.messageType, body }, options);
}
