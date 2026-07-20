import type {
  DeviceLease,
  InputSourceRegistry,
  InputSourceSession,
  UserInputSourceDefinition as ResolvedDeviceSourceDefinition,
  UserInputSourceResult,
} from "@tripley-kit/web-container-device-core";
import type { FrameworkLogMetadata } from "@tripley-kit/web-container-logging";

import type {
  FlowExecutionContext,
  FlowNodeExecutor,
  FlowNodeResult,
  InputProfile,
  UiFeedbackState,
  UiRouteState,
  UserInputNodeDefinition,
  UserInputSourceDefinition,
  UserInputValidationDefinition,
  UserInputValidationResult,
} from "./types";

export interface UserInputNodeExecutorOptions {
  readonly inputSources: InputSourceRegistry;
}

export class UserInputNodeExecutor implements FlowNodeExecutor<UserInputNodeDefinition> {
  public readonly kind = "userInput";

  public constructor(private readonly options: UserInputNodeExecutorOptions) {}

  public async execute(
    ctx: FlowExecutionContext,
    node: UserInputNodeDefinition,
  ): Promise<FlowNodeResult> {
    const profile = await resolveProfile(ctx, node);
    const ui = await resolveUi(ctx, node, profile);
    const validation = await resolveValidation(ctx, node, profile);
    const sources = await resolveSources(ctx, node, profile);
    const enabledSources = await resolveEnabledSources(ctx, sources);
    const deviceIds = enabledSources.flatMap((source) =>
      source.deviceId ? [source.deviceId] : [],
    );
    let lease: DeviceLease | undefined;
    const sessions: InputSourceSession[] = [];
    const settledSessionIds = new Set<string>();
    let exitReason = "node.exit";

    ctx.setUiFeedback({
      stateKey: ui?.stateKey,
      status: "waiting",
    });

    try {
      lease = await ctx.deviceLocks.acquire(deviceIds, {
        owner: {
          id: `${ctx.instanceId}.${node.id}`,
          type: "flowNode",
          flowInstanceId: ctx.instanceId,
          nodeId: node.id,
        },
        reason: "userInput",
      });

      for (const source of enabledSources) {
        const adapter = this.options.inputSources.require(source.kind);
        await adapter.validateDefinition?.(source);
        if (!(await adapter.canStart(ctx, source))) {
          continue;
        }

        sessions.push(await adapter.start(ctx, source));
      }

      if (sessions.length === 0) {
        return {
          type: "fail",
          error: new Error(`No input source could start for node: ${node.id}`),
        };
      }

      const race = await waitForInput(ctx, node, sessions, settledSessionIds);
      if (race.type === "timeout") {
        exitReason = "timeout";
        const timeoutResult = ctx.policies.userInputTimeout?.onTimeout;
        const feedback = toFeedback(ui, {
          valid: false,
          reasonCode: "USER_INPUT.TIMEOUT",
          messageKey: "userInput.timeout",
          severity: "warning",
        });
        ctx.setUiFeedback({ ...feedback, status: "timeout" });
        return (
          timeoutResult ?? {
            type: "cancel",
            reasonCode: "USER_INPUT.TIMEOUT",
            source: "timeout",
          }
        );
      }

      if (race.type === "interrupt") {
        exitReason = "interrupt";
        ctx.setUiFeedback({
          stateKey: ui?.stateKey,
          status: "interrupted",
          reasonCode: race.interrupt.reasonCode,
        });
        return {
          type: "cancel",
          reasonCode: race.interrupt.reasonCode,
          source: "interrupt",
          metadata: { interruptId: race.interrupt.id },
        };
      }

      const secure =
        node.input.security === "secure" || enabledSources.some((source) => source.secure);
      const summary = summarizeUserInputResult(race.result, secure);
      ctx.trace.record({
        type: "userInput.result",
        flowId: ctx.flowId,
        flowVersion: ctx.flowVersion,
        instanceId: ctx.instanceId,
        nodeId: node.id,
        summary,
      });
      logUserInputSummary(ctx, node.id, summary);

      const localValidation = await validateLocal(race.result, profile, ctx, validation);
      if (!localValidation.valid) {
        const feedback = toFeedback(ui, localValidation);
        ctx.setUiFeedback(feedback);
        return {
          type: "stay",
          nodeId: node.id,
          feedback,
        };
      }

      const businessValidation = await validation?.business?.(race.result, profile, ctx);
      if (businessValidation && !businessValidation.valid) {
        const feedback = toFeedback(ui, businessValidation);
        ctx.setUiFeedback(feedback);
        return {
          type: "reenter",
          nodeId: node.id,
          feedback,
        };
      }

      ctx.setUiFeedback({
        stateKey: ui?.stateKey,
        status: "valid",
      });

      const output =
        businessValidation?.value ??
        localValidation.value ??
        race.result.value ??
        (secure ? race.result : undefined);

      if (!node.next) {
        return { type: "end", output };
      }

      return {
        type: "next",
        nodeId: node.next,
        output,
      };
    } finally {
      await cancelActiveSessions(sessions, settledSessionIds, exitReason);
      await lease?.release();
    }
  }
}

type InputRaceResult =
  | {
      readonly type: "result";
      readonly session: InputSourceSession;
      readonly result: UserInputSourceResult;
    }
  | { readonly type: "timeout" }
  | {
      readonly type: "interrupt";
      readonly interrupt: { readonly id: string; readonly reasonCode: string };
    };

const resolveProfile = async (
  ctx: FlowExecutionContext,
  node: UserInputNodeDefinition,
): Promise<InputProfile> => {
  if (!node.input.profile) {
    return {
      id: node.id,
      promptKey: `${node.id}.prompt`,
    };
  }

  return typeof node.input.profile === "function" ? node.input.profile(ctx) : node.input.profile;
};

const resolveUi = async (
  ctx: FlowExecutionContext,
  node: UserInputNodeDefinition,
  profile: InputProfile,
): Promise<UiRouteState | undefined> => {
  if (!node.input.ui) {
    return undefined;
  }

  return typeof node.input.ui === "function" ? node.input.ui(profile, ctx) : node.input.ui;
};

const resolveValidation = async (
  ctx: FlowExecutionContext,
  node: UserInputNodeDefinition,
  profile: InputProfile,
): Promise<UserInputValidationDefinition | undefined> => {
  if (!node.input.validation) {
    return undefined;
  }

  return typeof node.input.validation === "function"
    ? node.input.validation(profile, ctx)
    : node.input.validation;
};

const resolveSources = async (
  ctx: FlowExecutionContext,
  node: UserInputNodeDefinition,
  profile: InputProfile,
): Promise<ResolvedDeviceSourceDefinition[]> => {
  const sources =
    typeof node.input.sources === "function"
      ? await node.input.sources(profile, ctx)
      : node.input.sources;

  return Promise.all(sources.map((source) => resolveSource(source, profile, ctx)));
};

const resolveSource = async (
  source: UserInputSourceDefinition,
  profile: InputProfile,
  ctx: FlowExecutionContext,
): Promise<ResolvedDeviceSourceDefinition> => {
  const profileOptions = profile.sourceOptions?.[source.kind] ?? profile.sourceOptions?.[source.id];
  const explicitOptions =
    typeof source.options === "function" ? await source.options(profile, ctx) : source.options;
  const options =
    isRecord(profileOptions) && isRecord(explicitOptions)
      ? { ...profileOptions, ...explicitOptions }
      : (explicitOptions ?? profileOptions);

  return {
    id: source.id,
    kind: source.kind,
    deviceId: source.deviceId,
    required: source.required,
    enabledWhen: source.enabledWhen,
    options,
    secure: source.secure,
    dataClassification: source.dataClassification,
  };
};

const resolveEnabledSources = async (
  ctx: FlowExecutionContext,
  sources: readonly ResolvedDeviceSourceDefinition[],
): Promise<ResolvedDeviceSourceDefinition[]> => {
  const enabled: ResolvedDeviceSourceDefinition[] = [];
  for (const source of sources) {
    if (await isSourceEnabled(ctx, source)) {
      enabled.push(source);
    }
  }

  return enabled;
};

const isSourceEnabled = async (
  ctx: FlowExecutionContext,
  source: ResolvedDeviceSourceDefinition,
): Promise<boolean> => {
  if (source.enabledWhen === undefined) {
    return true;
  }

  if (typeof source.enabledWhen === "boolean") {
    return source.enabledWhen;
  }

  if (typeof source.enabledWhen === "string") {
    return ctx.evaluateCondition ? ctx.evaluateCondition(source.enabledWhen) : true;
  }

  return source.enabledWhen(ctx);
};

const waitForInput = async (
  ctx: FlowExecutionContext,
  node: UserInputNodeDefinition,
  sessions: readonly InputSourceSession[],
  settledSessionIds: Set<string>,
): Promise<InputRaceResult> => {
  const waits: Promise<InputRaceResult>[] = sessions.map(
    async (session): Promise<InputRaceResult> => {
      const result = await session.result;
      settledSessionIds.add(session.id);
      return { result, session, type: "result" };
    },
  );

  const timeoutMs =
    node.input.timeoutMs ?? node.timeoutMs ?? ctx.policies.userInputTimeout?.timeoutMs;
  if (timeoutMs !== undefined) {
    waits.push(
      new Promise((resolve) => {
        setTimeout(() => resolve({ type: "timeout" }), timeoutMs);
      }),
    );
  }

  if (ctx.interrupt) {
    waits.push(
      ctx.interrupt.then((interrupt) => ({
        type: "interrupt",
        interrupt,
      })),
    );
  }

  if (ctx.signal) {
    waits.push(
      new Promise((resolve) => {
        if (ctx.signal?.aborted) {
          resolve({ type: "interrupt", interrupt: { id: "abortSignal", reasonCode: "ABORTED" } });
          return;
        }

        ctx.signal?.addEventListener(
          "abort",
          () =>
            resolve({ type: "interrupt", interrupt: { id: "abortSignal", reasonCode: "ABORTED" } }),
          { once: true },
        );
      }),
    );
  }

  return Promise.race(waits);
};

const validateLocal = async (
  result: UserInputSourceResult,
  profile: InputProfile,
  ctx: FlowExecutionContext,
  validation: UserInputValidationDefinition | undefined,
): Promise<UserInputValidationResult> => {
  const constraintResult = validateConstraints(result, profile);
  if (!constraintResult.valid) {
    return constraintResult;
  }

  if (!validation?.local) {
    return {
      valid: true,
      value: result.value,
      safeSummary: result.safeSummary,
    };
  }

  return validation.local(result, profile, ctx);
};

const validateConstraints = (
  result: UserInputSourceResult,
  profile: InputProfile,
): UserInputValidationResult => {
  const value = typeof result.value === "string" ? result.value : undefined;
  const minLength = profile.constraints?.minLength;
  const maxLength = profile.constraints?.maxLength;

  if (value !== undefined && minLength !== undefined && value.length < minLength) {
    return {
      valid: false,
      reasonCode: "INPUT.MIN_LENGTH",
      messageKey: profile.errorMessageKeys?.minLength ?? "input.minLength",
      severity: "error",
      safeSummary: { sourceKind: result.source.kind, length: value.length, minLength },
    };
  }

  if (value !== undefined && maxLength !== undefined && value.length > maxLength) {
    return {
      valid: false,
      reasonCode: "INPUT.MAX_LENGTH",
      messageKey: profile.errorMessageKeys?.maxLength ?? "input.maxLength",
      severity: "error",
      safeSummary: { sourceKind: result.source.kind, length: value.length, maxLength },
    };
  }

  return {
    valid: true,
    value: result.value,
    safeSummary: result.safeSummary,
  };
};

const toFeedback = (
  ui: UiRouteState | undefined,
  validation: UserInputValidationResult,
): UiFeedbackState => ({
  stateKey: ui?.stateKey,
  status: validation.valid ? "valid" : "invalid",
  reasonCode: validation.reasonCode,
  messageKey: validation.messageKey,
  messageParams: validation.messageParams,
  severity: validation.severity ?? "error",
  fieldErrors: validation.fieldErrors,
});

export const summarizeUserInputResult = (
  result: UserInputSourceResult,
  secure: boolean,
): Record<string, unknown> => {
  if (secure) {
    return {
      sourceId: result.source.id,
      sourceKind: result.source.kind,
      secure: true,
      hasValue: result.value !== undefined || "encryptedPinBlock" in result,
      safeSummary: result.safeSummary ?? {},
    };
  }

  return {
    sourceId: result.source.id,
    sourceKind: result.source.kind,
    secure: false,
    safeSummary: result.safeSummary ?? {},
  };
};

const logUserInputSummary = (
  ctx: FlowExecutionContext,
  nodeId: string,
  summary: Record<string, unknown>,
): void => {
  if (!ctx.logger) {
    return;
  }

  const metadata: FrameworkLogMetadata = {
    eventId: "flow.userInput.captured",
    module: "flow-engine",
    action: "userInput",
    data: {
      flowId: ctx.flowId,
      flowVersion: ctx.flowVersion,
      instanceId: ctx.instanceId,
      nodeId,
      summary,
    },
  };
  ctx.logger.info(
    "User input captured",
    ctx.traceId ? { ...metadata, traceId: ctx.traceId } : metadata,
  );
};

const cancelActiveSessions = async (
  sessions: readonly InputSourceSession[],
  settledSessionIds: Set<string>,
  reason: string,
): Promise<void> => {
  await Promise.all(
    sessions
      .filter((session) => !settledSessionIds.has(session.id))
      .map((session) => session.cancel(reason)),
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
