import type {
  InteractionIntent,
  InteractionReducerContext,
  StepContext,
  StepHandler,
} from "@tripley-acctron/contracts";
import { InputSources } from "./input-sources";
import { InteractionRuntime } from "./interaction-runtime";
import type { ConfirmStepDefinition } from "./step-kit-types";
import { mapRouteOrThrow, requireUi, resolveState, routeFailedOrThrow } from "./step-kit-utils";

export function defineConfirmStep(definition: ConfirmStepDefinition): StepHandler {
  return async (ctx) => runConfirmStep(ctx, definition);
}

async function runConfirmStep(ctx: StepContext, definition: ConfirmStepDefinition) {
  const ui = requireUi(ctx, definition.id);
  const runtime = new InteractionRuntime(
    Object.assign(
      { ui, logger: ctx.logger },
      ctx.devices ? { devices: ctx.devices } : {},
      ctx.timeoutService ? { timeoutService: ctx.timeoutService } : {},
    ),
  );
  const initialState = resolveState(definition.state, ctx);

  const result = await runtime.run<string, typeof initialState, boolean>(
    Object.assign(
      {
        screen: definition.screen,
        initialState,
        render: (state: typeof initialState) => state,
        sources: () =>
          definition.sources ?? [
            InputSources.ui.confirmCancel(definition.screen),
            InputSources.pinpad.confirmCancel(),
          ],
        auditIntent: (intent: InteractionIntent) => auditConfirmIntent(ctx, definition.id, intent),
        reduce: (
          state: typeof initialState,
          intent: InteractionIntent,
          reducerCtx: InteractionReducerContext<typeof initialState, boolean>,
        ) => {
          if (intent.type === "confirm") {
            return reducerCtx.accept(true);
          }
          if (intent.type === "cancel") {
            return reducerCtx.cancel();
          }
          return reducerCtx.update(state);
        },
      },
      definition.timeout ? { timeout: definition.timeout } : {},
    ),
  );

  if (result.type === "accepted") {
    await definition.commit?.(ctx);
    return ctx.next(definition.routes.confirmed);
  }
  if (result.type === "cancelled") {
    return mapRouteOrThrow(ctx, definition.routes.cancelled, "cancelled");
  }
  if (result.type === "timeout") {
    return mapRouteOrThrow(ctx, definition.routes.timeout, "timeout");
  }
  return routeFailedOrThrow(ctx, definition.routes.failed, result.error);
}

function auditConfirmIntent(ctx: StepContext, stepId: string, intent: InteractionIntent): void {
  ctx.logger.info("Confirm intent received.", {
    stepId,
    intentType: intent.type,
    source: intent.source,
  });
}
