import type {
  InteractionIntent,
  InteractionRunResult,
  InteractionReducerContext,
  RedactionKind,
  StepContext,
  StepHandler,
} from "@tripley-acctron/contracts";
import { InputSources } from "./input-sources";
import { InteractionRuntime } from "./interaction-runtime";
import type { TextInputStepDefinition, ValidationResult } from "./step-kit-types";
import { mapRouteOrThrow, requireUi, routeFailedOrThrow } from "./step-kit-utils";

interface TextInputState {
  value: string;
  error?: string;
}

export function defineTextInputStep<TValue = string>(
  definition: TextInputStepDefinition<TValue>,
): StepHandler {
  return async (ctx) => runTextInputStep(ctx, definition);
}

async function runTextInputStep<TValue>(
  ctx: StepContext,
  definition: TextInputStepDefinition<TValue>,
) {
  const ui = requireUi(ctx, definition.id);
  const runtime = new InteractionRuntime(
    Object.assign(
      { ui, logger: ctx.logger },
      ctx.devices ? { devices: ctx.devices } : {},
      ctx.audit ? { audit: ctx.audit } : {},
      ctx.redaction ? { redaction: ctx.redaction } : {},
      ctx.timeoutService ? { timeoutService: ctx.timeoutService } : {},
    ),
  );

  await ctx.audit?.beginPrompt(promptFromContext(ctx, definition.id, definition.screen));
  let result: InteractionRunResult<TValue>;
  try {
    result = await runtime.run<string, TextInputState, TValue>(
      Object.assign(
        {
          screen: definition.screen,
          initialState: { value: initialValue(definition, ctx) },
          render: (state: TextInputState) => renderTextInput(definition, state),
          sources: () =>
            definition.sources.length > 0 ? definition.sources : [InputSources.none()],
          auditIntent: (intent: InteractionIntent) => auditTextInputIntent(ctx, definition, intent),
          reduce: (
            state: TextInputState,
            intent: InteractionIntent,
            reducerCtx: InteractionReducerContext<TextInputState, TValue>,
          ) => reduceTextInput(ctx, definition, state, intent, reducerCtx),
        },
        definition.timeout ? { timeout: definition.timeout } : {},
      ),
    );
  } finally {
    await ctx.audit?.endPrompt(definition.id);
  }

  if (result.type === "accepted") {
    await definition.commit?.(ctx, result.value);
    return ctx.next(definition.routes.accepted);
  }
  if (result.type === "cancelled") {
    return mapRouteOrThrow(ctx, definition.routes.cancelled, definition.cancelRoute ?? "cancelled");
  }
  if (result.type === "timeout") {
    return mapRouteOrThrow(ctx, definition.routes.timeout, "timeout");
  }
  return routeFailedOrThrow(ctx, definition.routes.failed, result.error);
}

async function reduceTextInput<TValue>(
  ctx: StepContext,
  definition: TextInputStepDefinition<TValue>,
  state: TextInputState,
  intent: InteractionIntent,
  reducerCtx: InteractionReducerContext<TextInputState, TValue>,
) {
  if (intent.type === "append") {
    if (definition.value?.maxLength && state.value.length >= definition.value.maxLength) {
      return reducerCtx.update(state);
    }
    return reducerCtx.update({ value: state.value + intent.text });
  }
  if (intent.type === "backspace") {
    return reducerCtx.update({ value: state.value.slice(0, -1) });
  }
  if (intent.type === "clear") {
    return reducerCtx.update({ value: "" });
  }
  if (intent.type === "cancel") {
    return reducerCtx.cancel();
  }
  if (intent.type === "scan") {
    return reduceScan(ctx, definition, state, intent, reducerCtx);
  }
  if (intent.type === "submit") {
    const value = typeof intent.value === "string" ? intent.value : state.value;
    return validateAndAccept(ctx, definition, value, reducerCtx);
  }
  return reducerCtx.update(state);
}

async function reduceScan<TValue>(
  ctx: StepContext,
  definition: TextInputStepDefinition<TValue>,
  state: TextInputState,
  intent: Extract<InteractionIntent, { type: "scan" }>,
  reducerCtx: InteractionReducerContext<TextInputState, TValue>,
) {
  if (intent.parsed && !intent.parsed.ok) {
    return reducerCtx.update({ ...state, error: intent.parsed.error });
  }
  const value = intent.parsed?.ok ? String(intent.parsed.value) : intent.text;
  if (intent.parsed?.ok && intent.parsed.autoSubmit) {
    return validateAndAccept(ctx, definition, value, reducerCtx);
  }
  return reducerCtx.update({ value });
}

async function validateAndAccept<TValue>(
  ctx: StepContext,
  definition: TextInputStepDefinition<TValue>,
  value: string,
  reducerCtx: InteractionReducerContext<TextInputState, TValue>,
) {
  const builtIn = validateBuiltIn(definition, value);
  if (!builtIn.ok) {
    return reducerCtx.update({ value, error: builtIn.error });
  }
  const validated = definition.validate
    ? await definition.validate(value, ctx)
    : ({ ok: true, value } as ValidationResult<TValue>);
  return validated.ok
    ? reducerCtx.accept(validated.value)
    : reducerCtx.update({ value, error: validated.error });
}

function validateBuiltIn<TValue>(
  definition: TextInputStepDefinition<TValue>,
  value: string,
): ValidationResult<string> {
  if (definition.value?.minLength && value.length < definition.value.minLength) {
    return { ok: false, error: `Minimum length is ${definition.value.minLength}.` };
  }
  if (definition.value?.maxLength && value.length > definition.value.maxLength) {
    return { ok: false, error: `Maximum length is ${definition.value.maxLength}.` };
  }
  return { ok: true, value };
}

function initialValue<TValue>(
  definition: TextInputStepDefinition<TValue>,
  ctx: StepContext,
): string {
  const initial = definition.value?.initial;
  return typeof initial === "function" ? initial(ctx) : (initial ?? "");
}

function renderTextInput<TValue>(
  definition: TextInputStepDefinition<TValue>,
  state: TextInputState,
): Record<string, unknown> {
  return {
    value: definition.value?.mask ? "*".repeat(state.value.length) : state.value,
    error: state.error,
  };
}

async function auditTextInputIntent<TValue>(
  ctx: StepContext,
  definition: TextInputStepDefinition<TValue>,
  intent: InteractionIntent,
): Promise<void> {
  if (definition.audit === false) {
    return;
  }
  const input = {
    promptId: definition.id,
    flowId: ctx.flowId,
    nodeId: ctx.nodeId,
    stepId: definition.id,
    source: intent.source,
    inputType: intent.type,
    value: intentValue(intent),
  };
  const redactAs = definition.value?.redactAs as RedactionKind | undefined;
  await ctx.audit?.recordCustomerInput(redactAs ? { ...input, redactAs } : input);
  if (!ctx.audit) {
    ctx.logger.info("Text input intent received.", {
      stepId: definition.id,
      intentType: intent.type,
      source: intent.source,
      redactAs: definition.value?.redactAs,
    });
  }
}

function promptFromContext(ctx: StepContext, stepId: string, screen: string) {
  return { promptId: stepId, flowId: ctx.flowId, nodeId: ctx.nodeId, stepId, screen };
}

function intentValue(intent: InteractionIntent): unknown {
  if (intent.type === "append") {
    return intent.text;
  }
  if (intent.type === "submit" && "value" in intent) {
    return intent.value;
  }
  if (intent.type === "scan") {
    return intent.text;
  }
  if (intent.type === "select") {
    return intent.choiceId;
  }
  if (intent.type === "action") {
    return intent.action;
  }
  return undefined;
}
