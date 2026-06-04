import { KioskError, type StepContext } from "@tripley-acctron/contracts";

export function requireUi(ctx: StepContext, stepId: string) {
  if (!ctx.ui) {
    throw new KioskError("interaction.runtime", `Step ${stepId} requires UiPort.`);
  }
  return ctx.ui;
}

export function resolveState(
  state: Record<string, unknown> | ((ctx: StepContext) => Record<string, unknown>) | undefined,
  ctx: StepContext,
): Record<string, unknown> {
  return typeof state === "function" ? state(ctx) : (state ?? {});
}
