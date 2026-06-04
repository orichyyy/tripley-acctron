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
import type { ChoiceDefinition, ChoiceStepDefinition } from "./step-kit-types";
import { requireUi, resolveState } from "./step-kit-utils";

export function defineChoiceStep<TValue = unknown>(
  definition: ChoiceStepDefinition<TValue>,
): StepHandler {
  return async (ctx) => runChoiceStep(ctx, definition);
}

async function runChoiceStep<TValue>(ctx: StepContext, definition: ChoiceStepDefinition<TValue>) {
  requireUi(ctx, definition.id);
  const runtime = createInteractionRuntime(ctx);
  const initialState = {
    ...resolveState(definition.state, ctx),
    choices: definition.choices,
  };

  const result = await runPromptPolicy(ctx, promptPolicyFromDefinition(definition), () =>
    runtime.run<string, typeof initialState, ChoiceDefinition<TValue>>(
      Object.assign(
        {
          screen: definition.screen,
          initialState,
          render: (state: typeof initialState) => state,
          sources: () => definition.sources ?? defaultChoiceSources(definition),
          auditIntent: (intent: InteractionIntent) => auditChoiceIntent(ctx, definition, intent),
          reduce: (
            _state: typeof initialState,
            intent: InteractionIntent,
            reducerCtx: InteractionReducerContext<typeof initialState, ChoiceDefinition<TValue>>,
          ) => {
            if (intent.type === "select") {
              const choice = definition.choices.find(
                (candidate) => candidate.id === intent.choiceId,
              );
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
    ),
  );

  return routeInteractionResult(ctx, result, definition.routes ?? {}, async (choice) => {
    await definition.commit?.(ctx, choice);
    return ctx.next(choice.route);
  });
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

async function auditChoiceIntent(
  ctx: StepContext,
  definition: ChoiceStepDefinition,
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
    choiceId: choiceIdFromIntent(intent),
    source: intent.source,
  });
  if (!ctx.audit) {
    ctx.logger.info("Choice intent received.", {
      stepId,
      intentType: intent.type,
      source: intent.source,
    });
  }
}

function choiceIdFromIntent(intent: InteractionIntent): string {
  if (intent.type === "select") {
    return intent.choiceId;
  }
  if (intent.type === "cancel") {
    return "cancel";
  }
  return intent.type;
}
