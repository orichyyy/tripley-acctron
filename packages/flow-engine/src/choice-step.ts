import type {
  InteractionIntent,
  InteractionReducerContext,
  StepContext,
  StepHandler,
} from "@tripley-acctron/contracts";
import { InputSources } from "./input-sources";
import { InteractionRuntime } from "./interaction-runtime";
import type { ChoiceDefinition, ChoiceStepDefinition } from "./step-kit-types";
import { mapRouteOrThrow, requireUi, resolveState, routeFailedOrThrow } from "./step-kit-utils";

export function defineChoiceStep<TValue = unknown>(
  definition: ChoiceStepDefinition<TValue>,
): StepHandler {
  return async (ctx) => runChoiceStep(ctx, definition);
}

async function runChoiceStep<TValue>(ctx: StepContext, definition: ChoiceStepDefinition<TValue>) {
  const ui = requireUi(ctx, definition.id);
  const runtime = new InteractionRuntime(
    Object.assign(
      { ui, logger: ctx.logger },
      ctx.devices ? { devices: ctx.devices } : {},
      ctx.timeoutService ? { timeoutService: ctx.timeoutService } : {},
    ),
  );
  const initialState = {
    ...resolveState(definition.state, ctx),
    choices: definition.choices,
  };

  const result = await runtime.run<string, typeof initialState, ChoiceDefinition<TValue>>(
    Object.assign(
      {
        screen: definition.screen,
        initialState,
        render: (state: typeof initialState) => state,
        sources: () => definition.sources ?? defaultChoiceSources(definition),
        auditIntent: (intent: InteractionIntent) => auditChoiceIntent(ctx, definition.id, intent),
        reduce: (
          _state: typeof initialState,
          intent: InteractionIntent,
          reducerCtx: InteractionReducerContext<typeof initialState, ChoiceDefinition<TValue>>,
        ) => {
          if (intent.type === "select") {
            const choice = definition.choices.find((candidate) => candidate.id === intent.choiceId);
            return choice ? reducerCtx.accept(choice) : reducerCtx.update(initialState);
          }
          if (intent.type === "cancel") {
            return reducerCtx.cancel();
          }
          return reducerCtx.update(initialState);
        },
      },
      definition.timeout ? { timeout: definition.timeout } : {},
    ),
  );

  if (result.type === "accepted") {
    await definition.commit?.(ctx, result.value);
    return ctx.next(result.value.route);
  }
  if (result.type === "cancelled") {
    return mapRouteOrThrow(ctx, definition.routes?.cancelled, "cancelled");
  }
  if (result.type === "timeout") {
    return mapRouteOrThrow(ctx, definition.routes?.timeout, "timeout");
  }
  return routeFailedOrThrow(ctx, definition.routes?.failed, result.error);
}

function defaultChoiceSources<TValue>(definition: ChoiceStepDefinition<TValue>) {
  const mapping = Object.fromEntries(
    definition.choices.slice(0, 8).map((choice, index) => [`f${index + 1}`, choice.id]),
  );
  return [
    InputSources.ui.choice(definition.screen),
    InputSources.pinpad.functionKeys({ mapping: { ...mapping, cancel: "cancel" } }),
  ];
}

function auditChoiceIntent(ctx: StepContext, stepId: string, intent: InteractionIntent): void {
  ctx.logger.info("Choice intent received.", {
    stepId,
    intentType: intent.type,
    source: intent.source,
  });
}
