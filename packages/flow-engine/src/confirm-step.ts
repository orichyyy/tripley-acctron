import type {
  InteractionIntent,
  InteractionReducerContext,
  StepContext,
  StepHandler,
} from "@tripley-acctron/contracts";
import { InputSources } from "./input-sources";
import {
  createInteractionRuntime,
  promptPolicyFromDefinition,
  routeInteractionResult,
  runPromptPolicy,
} from "./step-policy";
import type { ConfirmStepDefinition } from "./step-kit-types";
import { requireUi, resolveState } from "./step-kit-utils";

export function defineConfirmStep(definition: ConfirmStepDefinition): StepHandler {
  return async (ctx) => runConfirmStep(ctx, definition);
}

async function runConfirmStep(ctx: StepContext, definition: ConfirmStepDefinition) {
  requireUi(ctx, definition.id);
  const runtime = createInteractionRuntime(ctx);
  const initialState = resolveState(definition.state, ctx);

  const result = await runPromptPolicy(ctx, promptPolicyFromDefinition(definition), () =>
    runtime.run<string, typeof initialState, boolean>(
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
          auditIntent: (intent: InteractionIntent) => auditConfirmIntent(ctx, definition, intent),
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
    ),
  );

  return routeInteractionResult(ctx, result, definition.routes, async () => {
    await definition.commit?.(ctx);
    return ctx.next(definition.routes.confirmed);
  });
}

async function auditConfirmIntent(
  ctx: StepContext,
  definition: ConfirmStepDefinition,
  intent: InteractionIntent,
): Promise<void> {
  if (definition.audit === false) {
    return;
  }
  const stepId = definition.id;
  await ctx.audit?.recordCustomerChoice({
    promptId: stepId,
    flowId: ctx.flowId,
    nodeId: ctx.nodeId,
    stepId,
    choiceId: intent.type === "confirm" ? "confirm" : intent.type,
    source: intent.source,
  });
  if (!ctx.audit) {
    ctx.logger.info("Confirm intent received.", {
      stepId,
      intentType: intent.type,
      source: intent.source,
    });
  }
}
