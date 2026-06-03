import { KioskError, type StepContext, type StepResult } from "@tripley-acctron/contracts";

export function requireUi(ctx: StepContext, stepId: string) {
  if (!ctx.ui) {
    throw new KioskError("interaction.runtime", `Step ${stepId} requires UiPort.`);
  }
  return ctx.ui;
}

export function mapRouteOrThrow(
  ctx: StepContext,
  route: string | undefined,
  fallback: string,
): StepResult {
  return ctx.next(route ?? fallback);
}

export function routeFailedOrThrow(
  ctx: StepContext,
  route: string | undefined,
  error: unknown,
): StepResult {
  if (route) {
    ctx.logger.error("Standard step failed and routed to failure.", { error, route });
    return ctx.next(route);
  }
  throw error;
}

export function resolveState(
  state: Record<string, unknown> | ((ctx: StepContext) => Record<string, unknown>) | undefined,
  ctx: StepContext,
): Record<string, unknown> {
  return typeof state === "function" ? state(ctx) : (state ?? {});
}
