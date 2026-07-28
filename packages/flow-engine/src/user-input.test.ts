import type {
  InputSourceAdapter,
  InputSourceSession,
  SecurePinInputResult,
  UserInputSourceDefinition,
  UserInputSourceResult,
} from "@tripley-kit/web-container-device-core";
import {
  createReplayableInputSourceProgress,
  InputSourceRegistry,
} from "@tripley-kit/web-container-device-core";
import type { FrameworkLogMetadata, LoggerPort } from "@tripley-kit/web-container-logging";
import { describe, expect, it, vi } from "vitest";

import { defineFlow, defineUserInputNode } from "./dsl";
import { FlowTestRunner } from "./test-runner";
import type { FlowDefinition, InputProfile, UserInputNodeDefinition } from "./types";

describe("UserInputNodeExecutor", () => {
  it("resolves dynamic minLength/maxLength options before starting adapters", async () => {
    const startedSources: UserInputSourceDefinition[] = [];
    const inputSources = new InputSourceRegistry();
    inputSources.register(
      createResolvedAdapter("test.input", async (source) => {
        startedSources.push(source);
        return plainResult(source, "12345");
      }),
    );

    const runner = new FlowTestRunner({ inputSources });
    const flow = singleUserInputFlow(
      defineUserInputNode({
        id: "enterAccount",
        kind: "userInput",
        input: {
          profile: (ctx) => {
            const input = ctx.input as { max: number; min: number };
            return {
              constraints: { maxLength: input.max, minLength: input.min },
              id: "account.dynamic",
              promptKey: "account.prompt",
            };
          },
          sources: [
            {
              id: "screen",
              kind: "test.input",
              options: (profile: InputProfile) => ({
                maxLength: profile.constraints?.maxLength,
                minLength: profile.constraints?.minLength,
              }),
            },
          ],
        },
      }),
    );

    const result = await runner.run(flow, { max: 6, min: 3 });

    expect(result.status).toBe("completed");
    expect(startedSources[0]?.options).toEqual({ maxLength: 6, minLength: 3 });
  });

  it("keeps local validation failures on the same node and updates UI feedback", async () => {
    const inputSources = new InputSourceRegistry();
    inputSources.register(
      createResolvedAdapter("test.input", async (source) => plainResult(source, "12")),
    );

    const runner = new FlowTestRunner({ inputSources });
    const flow = singleUserInputFlow(
      defineUserInputNode({
        id: "enterPhone",
        kind: "userInput",
        input: {
          profile: {
            constraints: { minLength: 4 },
            errorMessageKeys: { minLength: "phone.tooShort" },
            id: "phone",
            promptKey: "phone.prompt",
          },
          sources: [{ id: "screen", kind: "test.input" }],
          ui: { stateKey: "phone.input" },
        },
      }),
    );

    const result = await runner.run(flow, {});

    expect(result.currentNodeId).toBe("enterPhone");
    expect(result.result?.type).toBe("stay");
    expect(result.uiFeedback.at(-1)).toMatchObject({
      messageKey: "phone.tooShort",
      reasonCode: "INPUT.MIN_LENGTH",
      stateKey: "phone.input",
      status: "invalid",
    });
  });

  it("allows business validation to reenter the input node", async () => {
    const inputSources = new InputSourceRegistry();
    inputSources.register(
      createResolvedAdapter("test.input", async (source) => plainResult(source, "123456")),
    );

    const runner = new FlowTestRunner({ inputSources });
    const flow = singleUserInputFlow(
      defineUserInputNode({
        id: "enterAccount",
        kind: "userInput",
        input: {
          profile: {
            constraints: { minLength: 4 },
            id: "account",
            promptKey: "account.prompt",
          },
          sources: [{ id: "screen", kind: "test.input" }],
          ui: { stateKey: "account.input" },
          validation: {
            business: () => ({
              messageKey: "account.notFound",
              reasonCode: "HOST.ACCOUNT_NOT_FOUND",
              valid: false,
            }),
          },
        },
      }),
    );

    const result = await runner.run(flow, {});

    expect(result.currentNodeId).toBe("enterAccount");
    expect(result.result?.type).toBe("reenter");
    expect(result.uiFeedback.at(-1)).toMatchObject({
      messageKey: "account.notFound",
      reasonCode: "HOST.ACCOUNT_NOT_FOUND",
      stateKey: "account.input",
    });
  });

  it("returns the safe value produced by successful business validation", async () => {
    const inputSources = new InputSourceRegistry();
    inputSources.register(
      createResolvedAdapter("test.input", async (source) =>
        plainResult(source, "raw-sensitive-credential"),
      ),
    );
    const runner = new FlowTestRunner({ inputSources });
    const flow = singleUserInputFlow(
      defineUserInputNode({
        id: "verifyCredential",
        kind: "userInput",
        input: {
          profile: { id: "credential", promptKey: "credential.prompt" },
          sources: [{ id: "credential", kind: "test.input", secure: true }],
          validation: {
            business: () => ({
              safeSummary: { verified: true },
              valid: true,
              value: { credentialId: "safe-reference" },
            }),
          },
        },
      }),
    );

    const result = await runner.run(flow, {});

    expect(result.output).toEqual({ credentialId: "safe-reference" });
    expect(JSON.stringify(result.trace)).not.toContain("raw-sensitive-credential");
  });

  it("logs only safe summaries for secure pin input", async () => {
    const logger = new MemoryLogger();
    const inputSources = new InputSourceRegistry();
    inputSources.register(
      createResolvedAdapter("pinpad.pin", async (source) => securePinResult(source)),
    );

    const runner = new FlowTestRunner({ inputSources });
    const flow = singleUserInputFlow(
      defineUserInputNode({
        id: "enterPin",
        kind: "userInput",
        input: {
          profile: {
            id: "pin",
            promptKey: "pin.prompt",
          },
          security: "secure",
          sources: [{ id: "pinpad", kind: "pinpad.pin", secure: true }],
          trace: { safeToLog: false, summaryOnly: true },
          ui: { stateKey: "pin.input" },
        },
      }),
    );

    const result = await runner.run(flow, {}, { logger });
    const serializedDiagnostics = JSON.stringify({
      logs: logger.records,
      trace: result.trace,
    });

    expect(serializedDiagnostics).not.toContain("ENCRYPTED-PIN-BLOCK-1234");
    expect(serializedDiagnostics).toContain("hasEncryptedPinBlock");
    expect(serializedDiagnostics).toContain("pinpad.pin");
  });

  it("cancels active input source sessions on timeout, interrupt, and node exit", async () => {
    const timeoutCancels: string[] = [];
    const timeoutSources = new InputSourceRegistry();
    timeoutSources.register(createPendingAdapter("test.pending", timeoutCancels));
    await new FlowTestRunner({ inputSources: timeoutSources }).run(
      singleUserInputFlow(
        defineUserInputNode({
          id: "timeoutInput",
          kind: "userInput",
          input: {
            sources: [{ id: "pending", kind: "test.pending" }],
            timeoutMs: 1,
          },
        }),
      ),
      {},
    );

    const interruptCancels: string[] = [];
    const interruptSources = new InputSourceRegistry();
    interruptSources.register(createPendingAdapter("test.interrupt", interruptCancels));
    await new FlowTestRunner({ inputSources: interruptSources }).run(
      singleUserInputFlow(
        defineUserInputNode({
          id: "interruptInput",
          kind: "userInput",
          input: {
            sources: [{ id: "pending", kind: "test.interrupt" }],
          },
        }),
      ),
      {},
      { interrupt: Promise.resolve({ id: "card.removed", reasonCode: "CARD.REMOVED" }) },
    );

    const exitCancels: string[] = [];
    const exitSources = new InputSourceRegistry();
    exitSources.register(
      createResolvedAdapter("test.winner", async (source) => plainResult(source, "ok")),
    );
    exitSources.register(createPendingAdapter("test.loser", exitCancels));
    await new FlowTestRunner({ inputSources: exitSources }).run(
      singleUserInputFlow(
        defineUserInputNode({
          id: "raceInput",
          kind: "userInput",
          input: {
            sources: [
              { id: "winner", kind: "test.winner" },
              { id: "loser", kind: "test.loser" },
            ],
          },
        }),
      ),
      {},
    );

    expect(timeoutCancels).toEqual(["timeout"]);
    expect(interruptCancels).toEqual(["interrupt"]);
    expect(exitCancels).toEqual(["node.exit"]);
  });

  it("resets idle timeout on safe activity without extending the hard timeout", async () => {
    vi.useFakeTimers();
    try {
      const progress = createReplayableInputSourceProgress();
      const cancels: string[] = [];
      const inputSources = new InputSourceRegistry();
      inputSources.register({
        kind: "test.progress",
        canStart: () => true,
        start: async (_ctx, source): Promise<InputSourceSession> => ({
          cancel: async (reason) => {
            cancels.push(reason ?? "");
          },
          id: "session.progress",
          progress,
          result: new Promise(() => {}),
          sourceId: source.id,
          sourceKind: source.kind,
        }),
      });
      const run = new FlowTestRunner({ inputSources }).run(
        singleUserInputFlow(
          defineUserInputNode({
            id: "progressInput",
            kind: "userInput",
            input: {
              idleTimeoutMs: 10,
              sources: [{ id: "progress", kind: "test.progress" }],
              timeoutMs: 30,
            },
          }),
        ),
        {},
      );
      await vi.advanceTimersByTimeAsync(0);
      for (const digitCount of [1, 2, 3]) {
        await vi.advanceTimersByTimeAsync(7);
        progress.publish({
          activity: true,
          kind: "pinpad.digitCount",
          safeSummary: { digitCount },
        });
      }
      await vi.advanceTimersByTimeAsync(9);

      const result = await run;
      expect(result.status).toBe("cancelled");
      expect(
        result.uiFeedback.filter((feedback) => feedback.safeData).at(-1)
          ?.safeData,
      ).toEqual({ digitCount: 3 });
      expect(cancels).toEqual(["timeout"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs a custom input device plugin without modifying core", async () => {
    const inputSources = new InputSourceRegistry();
    inputSources.register({
      id: "bank.idCardReader.identity",
      ownerPluginId: "bank-plugin",
      value: createResolvedAdapter("bank.idCardReader.identity", async (source) =>
        plainResult(source, "ID-CARD-42"),
      ),
    });

    const runner = new FlowTestRunner({ inputSources });
    const flow = singleUserInputFlow(
      defineUserInputNode({
        id: "readIdentity",
        kind: "userInput",
        input: {
          sources: [
            {
              id: "idCardReader",
              kind: "bank.idCardReader.identity",
              options: { acceptedDocumentTypes: ["nationalId", "passport"] },
            },
          ],
        },
      }),
    );

    const result = await runner.run(flow, {});

    expect(result.status).toBe("completed");
    expect(result.output).toBe("ID-CARD-42");
  });
});

const singleUserInputFlow = (node: UserInputNodeDefinition): FlowDefinition =>
  defineFlow({
    id: "test.flow",
    nodes: { [node.id]: node },
    startNodeId: node.id,
    version: "2.0.0",
  });

const createResolvedAdapter = (
  kind: string,
  resolve: (source: UserInputSourceDefinition) => Promise<UserInputSourceResult>,
): InputSourceAdapter => ({
  kind,
  canStart: () => true,
  start: async (_ctx, source) => ({
    id: `session.${source.id}`,
    sourceId: source.id,
    sourceKind: source.kind,
    result: resolve(source),
    cancel: async () => {},
  }),
});

const createPendingAdapter = (kind: string, cancels: string[]): InputSourceAdapter => ({
  kind,
  canStart: () => true,
  start: async (_ctx, source) => ({
    id: `session.${source.id}`,
    sourceId: source.id,
    sourceKind: source.kind,
    result: new Promise<UserInputSourceResult>(() => {}),
    cancel: async (reason) => {
      cancels.push(reason ?? "");
    },
  }),
});

const plainResult = (
  source: UserInputSourceDefinition,
  value: string,
): UserInputSourceResult<string> => ({
  kind: "plain",
  safeSummary: { length: value.length },
  source: {
    id: source.id,
    kind: source.kind,
  },
  value,
});

const securePinResult = (source: UserInputSourceDefinition): SecurePinInputResult => ({
  encryptedPinBlock: "ENCRYPTED-PIN-BLOCK-1234",
  kind: "securePin",
  pinBlockFormat: "ISO9564-0",
  safeSummary: {
    hasEncryptedPinBlock: true,
    pinBlockFormat: "ISO9564-0",
    sourceKind: "pinpad.pin",
  },
  source: {
    id: source.id,
    kind: "pinpad.pin",
  },
});

class MemoryLogger implements LoggerPort {
  public readonly records: readonly {
    readonly message: string;
    readonly metadata: FrameworkLogMetadata;
  }[] = [];

  public trace(message: string, metadata: FrameworkLogMetadata): void {
    this.write(message, metadata);
  }

  public debug(message: string, metadata: FrameworkLogMetadata): void {
    this.write(message, metadata);
  }

  public info(message: string, metadata: FrameworkLogMetadata): void {
    this.write(message, metadata);
  }

  public warn(message: string, metadata: FrameworkLogMetadata): void {
    this.write(message, metadata);
  }

  public error(message: string, _error: unknown, metadata: FrameworkLogMetadata): void {
    this.write(message, metadata);
  }

  public child(): LoggerPort {
    return this;
  }

  private write(message: string, metadata: FrameworkLogMetadata): void {
    (this.records as { readonly message: string; readonly metadata: FrameworkLogMetadata }[]).push({
      message,
      metadata,
    });
  }
}
