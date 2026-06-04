import type { InteractionRunResult, StepContext, StepResult } from "@tripley-acctron/contracts";
import { KioskError } from "@tripley-acctron/contracts";
import { InteractionRuntime } from "./interaction-runtime";
import type { StepPolicyValue } from "./step-kit-types";

export interface PromptPolicy {
  stepId: string;
  screen: string;
  audit?: false | string;
  voiceGuide?: StepPolicyValue;
  tts?: StepPolicyValue;
}

export interface InteractionRoutes {
  cancelled?: string;
  timeout?: string;
  failed?: string;
}

export function promptPolicyFromDefinition(definition: {
  id: string;
  screen: string;
  audit?: false | string;
  voiceGuide?: StepPolicyValue;
  tts?: StepPolicyValue;
}): PromptPolicy {
  return Object.assign(
    { stepId: definition.id, screen: definition.screen },
    definition.audit !== undefined ? { audit: definition.audit } : {},
    definition.voiceGuide !== undefined ? { voiceGuide: definition.voiceGuide } : {},
    definition.tts !== undefined ? { tts: definition.tts } : {},
  );
}

export function createInteractionRuntime(ctx: StepContext) {
  return new InteractionRuntime(
    Object.assign(
      { ui: requirePolicyUi(ctx), logger: ctx.logger, signal: ctx.scope.signal },
      ctx.devices ? { devices: ctx.devices } : {},
      ctx.audit ? { audit: ctx.audit } : {},
      ctx.redaction ? { redaction: ctx.redaction } : {},
      ctx.timeoutService ? { timeoutService: ctx.timeoutService } : {},
    ),
  );
}

export async function runPromptPolicy<TResult>(
  ctx: StepContext,
  policy: PromptPolicy,
  run: () => Promise<TResult>,
): Promise<TResult> {
  if (policy.audit !== false) {
    await ctx.audit?.beginPrompt(promptFromContext(ctx, policy.stepId, policy.screen));
  }
  try {
    if (hasPromptGuidance(policy)) {
      await playPromptGuidance(ctx, policy);
    }
    return await run();
  } finally {
    if (policy.audit !== false) {
      await ctx.audit?.endPrompt(policy.stepId);
    }
  }
}

function hasPromptGuidance(policy: PromptPolicy): boolean {
  return policy.voiceGuide !== undefined || policy.tts !== undefined;
}

export async function routeInteractionResult<TValue>(
  ctx: StepContext,
  result: InteractionRunResult<TValue>,
  routes: InteractionRoutes,
  onAccepted: (value: TValue) => Promise<StepResult> | StepResult,
): Promise<StepResult> {
  if (result.type === "accepted") {
    return onAccepted(result.value);
  }
  if (result.type === "cancelled") {
    return mapRouteOrThrow(ctx, routes.cancelled, "cancelled");
  }
  if (result.type === "timeout") {
    return mapRouteOrThrow(ctx, routes.timeout, "timeout");
  }
  return routeFailedOrThrow(ctx, routes.failed, result.error);
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

async function playPromptGuidance(ctx: StepContext, policy: PromptPolicy): Promise<void> {
  const voiceGuide = await resolvePolicyValue(ctx, policy.voiceGuide);
  if (voiceGuide) {
    await ctx.voiceGuide?.play(voiceGuide);
  }
  const tts = await resolvePolicyValue(ctx, policy.tts);
  if (tts) {
    await ctx.tts?.speak(tts);
  }
}

async function resolvePolicyValue(
  ctx: StepContext,
  value: StepPolicyValue | undefined,
): Promise<string | undefined> {
  if (value === false || value === undefined) {
    return undefined;
  }
  return typeof value === "function" ? value(ctx) : value;
}

function requirePolicyUi(ctx: StepContext) {
  if (!ctx.ui) {
    throw new KioskError("interaction.runtime", "Standard interaction step requires UiPort.");
  }
  return ctx.ui;
}

function promptFromContext(ctx: StepContext, stepId: string, screen: string) {
  return { promptId: stepId, flowId: ctx.flowId, nodeId: ctx.nodeId, stepId, screen };
}
