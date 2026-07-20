import type {
  DeviceLockManager,
  DeviceRegistry,
  InputSourceRegistry,
} from "@tripley-kit/web-container-device-core";
import { FrameworkError } from "@tripley-kit/web-container-errors";
import {
  FlowTestRunner,
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
}

export const runUserInput = async (
  ctx: OperationExecutionContext,
  dependencies: InputRunnerDependencies,
  options: RunInputOptions,
): Promise<unknown> => {
  while (true) {
    const externalDevice = options.sources.every((source) => source.kind !== "ui.command");
    ctx.updateView({
      phase: "collectingInput",
      promptId: options.promptId,
      safeData: {
        externalDevice,
        inputMode: options.profile.constraints?.inputMode ?? "text",
        maxLength: options.profile.constraints?.maxLength ?? null,
        minLength: options.profile.constraints?.minLength ?? null,
        secure: options.security === "secure",
        secureDevice: options.security === "secure" && externalDevice,
      },
    });
    const node = defineUserInputNode({
      id: options.id,
      input: {
        profile: options.profile,
        security: options.security,
        sources: options.sources,
        timeoutMs: ctx.interactionTimeout(options.id),
        trace: { safeToLog: false, summaryOnly: true },
        ui: { stateKey: `operation.${options.id}` },
        validation: options.validation,
      },
      kind: "userInput",
    });
    const flow = defineFlow({
      id: `kiosk.operation.${options.id}`,
      nodes: { [node.id]: node },
      startNodeId: node.id,
      trace: { redactSecureInput: true, summaryOnly: true },
      version: "1.0.0",
    });
    const snapshot = await new FlowTestRunner({ inputSources: dependencies.inputSources }).run(
      flow,
      {},
      {
        deviceLocks: dependencies.locks,
        devices: dependencies.devices,
        signal: ctx.signal,
      },
    );
    if (snapshot.status === "completed") {
      return snapshot.output;
    }
    if (snapshot.result?.type === "stay" || snapshot.result?.type === "reenter") {
      ctx.consumeAttempt(options.attemptPolicyId ?? options.id);
      ctx.updateView({
        feedback: {
          messageKey: snapshot.result.feedback.messageKey ?? "input.invalid",
          reasonCode: snapshot.result.feedback.reasonCode,
          severity: snapshot.result.feedback.severity ?? "error",
        },
      });
      continue;
    }
    throw new FrameworkError({
      category: "dependency",
      code: snapshot.result?.type === "cancel" ? snapshot.result.reasonCode : "input.failed",
      message: `Input stage failed: ${options.id}`,
    });
  }
};
