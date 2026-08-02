import type {
  DeviceLockManager,
  DeviceRegistry,
  InputInteractionIdentity,
  InputSourceRegistry,
} from "@tripley-kit/web-container-device-core";
import { FrameworkError } from "@tripley-kit/web-container-errors";
import {
  type FlowEngine,
  type InputProfile,
  type UserInputSourceDefinition,
  type UserInputValidationDefinition,
  defineFlow,
  defineUserInputNode,
} from "@tripley-kit/web-container-flow-engine";
import type { OperationExecutionContext } from "@tripley-kit/web-container-kiosk-runtime";

export interface RunInputOptions {
  readonly id: string;
  readonly promptId: string;
  readonly profile: InputProfile;
  readonly sources: readonly UserInputSourceDefinition[];
  readonly validation?: UserInputValidationDefinition | undefined;
  readonly security?: "plain" | "secure" | undefined;
  readonly attemptPolicyId?: string | undefined;
}

export interface InputRunnerDependencies {
  readonly devices: DeviceRegistry;
  readonly locks: DeviceLockManager;
  readonly inputSources: InputSourceRegistry;
  readonly flowEngine: FlowEngine;
  readonly programmaticInputKinds?: readonly string[] | undefined;
}

interface InputAttempt {
  readonly flow: ReturnType<typeof defineFlow>;
  readonly instanceId: string;
  readonly safeViewData: Record<string, unknown>;
}

export const runUserInput = async (
  ctx: OperationExecutionContext,
  dependencies: InputRunnerDependencies,
  options: RunInputOptions,
): Promise<unknown> => {
  const programmaticKinds = new Set(
    dependencies.programmaticInputKinds ?? ["ui.command"],
  );
  while (true) {
    const attempt = createInputAttempt(ctx, options, programmaticKinds);
    const result = await executeInputAttempt(ctx, dependencies, options, attempt);
    if (result.status === "completed") {
      return result.output;
    }
    if (result.type === "stay" || result.type === "reenter") {
      ctx.consumeAttempt(options.attemptPolicyId ?? options.id);
      updateValidationFeedback(ctx, result.feedback);
      continue;
    }
    throw new FrameworkError({
      category: "dependency",
      code: result.type === "cancel" ? result.reasonCode : "input.failed",
      message: `Input stage failed: ${options.id}`,
    });
  }
};

const createInputAttempt = (
  ctx: OperationExecutionContext,
  options: RunInputOptions,
  programmaticKinds: ReadonlySet<string>,
): InputAttempt => {
  const instanceId = `kiosk-input-${crypto.randomUUID()}`;
  const identity: InputInteractionIdentity = {
    channelId: "customer",
    flowInstanceId: instanceId,
    interactionId: crypto.randomUUID(),
    nodeId: options.id,
  };
  const allowedIntentIds = ["kiosk.input.submit"];
  const sources = correlateProgrammaticSources(
    options.sources,
    programmaticKinds,
    identity,
    allowedIntentIds,
  );
  const hasProgrammaticSource = sources.some((source) =>
    programmaticKinds.has(source.kind),
  );
  const externalDevice = options.sources.every(
    (source) => source.kind !== "ui.command",
  );
  const safeViewData: Record<string, unknown> = {
    externalDevice,
    inputMode: options.profile.constraints?.inputMode ?? "text",
    maxLength: options.profile.constraints?.maxLength ?? null,
    minLength: options.profile.constraints?.minLength ?? null,
    secure: options.security === "secure",
    secureDevice: options.security === "secure" && externalDevice,
    ...(hasProgrammaticSource
      ? {
          allowedIntentIds,
          interactionIdentity: {
            channelId: identity.channelId,
            flowInstanceId: identity.flowInstanceId,
            interactionId: identity.interactionId,
            nodeId: identity.nodeId,
          },
        }
      : {}),
  };
  ctx.updateView({
    phase: "collectingInput",
    promptId: options.promptId,
    safeData: safeViewData,
  });
  const node = defineUserInputNode({
    id: options.id,
    input: {
      profile: options.profile,
      security: options.security,
      sources,
      timeoutMs: ctx.interactionTimeout(options.id),
      trace: { safeToLog: false, summaryOnly: true },
      ui: { stateKey: `operation.${options.id}` },
      validation: options.validation,
    },
    kind: "userInput",
  });
  const flow = defineFlow({
    id: `kiosk.operation.${ctx.operationId}.${options.id}`,
    nodes: { [node.id]: node },
    startNodeId: node.id,
    trace: { redactSecureInput: true, summaryOnly: true },
    version: "1.0.0",
  });
  return { flow, instanceId, safeViewData };
};

const executeInputAttempt = async (
  ctx: OperationExecutionContext,
  dependencies: InputRunnerDependencies,
  options: RunInputOptions,
  attempt: InputAttempt,
) => {
  const { flow, instanceId, safeViewData } = attempt;
  dependencies.flowEngine.register(flow);
  try {
    const instance = await dependencies.flowEngine.start(
      flow.id,
      {},
      {
        deviceLocks: dependencies.locks,
        devices: dependencies.devices,
        onUiFeedback: (feedback) => {
          if (feedback.status === "waiting" && feedback.safeData) {
            ctx.updateView({
              safeData: {
                ...safeViewData,
                ...feedback.safeData,
              },
            });
          }
          if (feedback.status !== "invalid") {
            return;
          }
          updateValidationFeedback(ctx, feedback);
        },
        instanceId,
        signal: ctx.signal,
        stopOn: ["stay", "reenter"],
      },
    );
    const snapshot = await instance.completion;
    if (snapshot.status === "completed") {
      return { output: snapshot.output, status: "completed" as const };
    }
    if (snapshot.result?.type === "stay" || snapshot.result?.type === "reenter") {
      return snapshot.result;
    }
    return snapshot.result ?? { error: new Error("Input flow ended without a result."), type: "fail" as const };
  } finally {
    dependencies.flowEngine.unregister(flow.id, flow.version);
  }
};

const updateValidationFeedback = (
  ctx: OperationExecutionContext,
  feedback: {
    readonly messageKey?: string | undefined;
    readonly reasonCode: string;
    readonly severity?: "error" | "info" | "warning" | undefined;
  },
): void => {
  ctx.updateView({
    feedback: {
      messageKey: feedback.messageKey ?? "input.invalid",
      reasonCode: feedback.reasonCode,
      severity: feedback.severity ?? "error",
    },
  });
};

const correlateProgrammaticSources = (
  sources: readonly UserInputSourceDefinition[],
  programmaticKinds: ReadonlySet<string>,
  identity: InputInteractionIdentity,
  allowedIntentIds: readonly string[],
): readonly UserInputSourceDefinition[] =>
  sources.map((source) => {
    if (!programmaticKinds.has(source.kind)) {
      return source;
    }
    return {
      ...source,
      options: {
        ...(isRecord(source.options) ? source.options : {}),
        allowedIntentIds,
        identity,
      },
    };
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
