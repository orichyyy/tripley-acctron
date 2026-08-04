import { FrameworkError } from "@tripley-kit/web-container-errors";

import type { InputInteractionIdentity } from "./programmatic-input";
import type {
  InputSourceAdapter,
  InputSourceExecutionContext,
  InputSourceSession,
  UserInputSourceResult,
} from "./input-sources";

export type InputCompletionIdentity = Pick<
  InputInteractionIdentity,
  "flowInstanceId" | "interactionId" | "nodeId"
>;

export interface InputCompletionRequest {
  readonly identity: InputCompletionIdentity;
  readonly sourceId?: string | undefined;
  readonly sourceKind?: string | undefined;
}

export type InputCompletionResult =
  | { readonly accepted: true }
  | {
      readonly accepted: false;
      readonly reasonCode: "INPUT.MIN_LENGTH";
      readonly safeSummary: Readonly<Record<string, unknown>>;
    };

interface ActiveCompletion {
  completing: boolean;
  digitCount: number;
  readonly identity: InputCompletionIdentity;
  readonly minLength: number;
  readonly session: InputSourceSession;
  unsubscribe(): void;
}

export class CorrelatedInputCompletionBroker {
  private readonly active = new Map<string, Map<string, ActiveCompletion>>();

  public register(input: {
    readonly identity: InputCompletionIdentity;
    readonly minLength?: number | undefined;
    readonly session: InputSourceSession;
  }): () => void {
    if (!input.session.complete) return () => undefined;
    const key = identityKey(input.identity);
    const sessions = this.active.get(key) ?? new Map<string, ActiveCompletion>();
    const subscription = input.session.progress?.subscribe((progress) => {
      const digitCount = progress.safeSummary.digitCount;
      const active = sessions.get(input.session.id);
      if (active && typeof digitCount === "number" && Number.isSafeInteger(digitCount)) {
        active.digitCount = Math.max(0, digitCount);
      }
    });
    const active: ActiveCompletion = {
      completing: false,
      digitCount: 0,
      identity: input.identity,
      minLength: Math.max(0, input.minLength ?? 0),
      session: input.session,
      unsubscribe: () => subscription?.unsubscribe(),
    };
    sessions.set(input.session.id, active);
    this.active.set(key, sessions);
    const unregister = (): void => this.unregister(key, input.session.id);
    void input.session.result.then(unregister, unregister);
    return unregister;
  }

  public async complete(request: InputCompletionRequest): Promise<InputCompletionResult> {
    const candidates = [...(this.active.get(identityKey(request.identity))?.values() ?? [])]
      .filter((active) => matches(active.session, request));
    if (candidates.length !== 1) {
      throw completionError(
        candidates.length === 0
          ? "inputCompletion.noPending"
          : "inputCompletion.ambiguous",
        candidates.length === 0
          ? "No matching device input is pending."
          : "More than one matching device input is pending.",
      );
    }
    const active = candidates[0]!;
    if (active.completing) {
      throw completionError(
        "inputCompletion.duplicate",
        "Device input completion is already in progress.",
      );
    }
    if (active.digitCount < active.minLength) {
      return {
        accepted: false,
        reasonCode: "INPUT.MIN_LENGTH",
        safeSummary: {
          digitCount: active.digitCount,
          minLength: active.minLength,
          sourceKind: active.session.sourceKind,
        },
      };
    }
    active.completing = true;
    try {
      await active.session.complete?.("ui.confirm");
      return { accepted: true };
    } catch (error) {
      active.completing = false;
      throw error;
    }
  }

  private unregister(identity: string, sessionId: string): void {
    const sessions = this.active.get(identity);
    const active = sessions?.get(sessionId);
    active?.unsubscribe();
    sessions?.delete(sessionId);
    if (sessions?.size === 0) this.active.delete(identity);
  }
}

export const withInputCompletionBroker = <
  TOptions,
  TResult extends UserInputSourceResult,
>(
  adapter: InputSourceAdapter<TOptions, TResult>,
  broker: CorrelatedInputCompletionBroker,
): InputSourceAdapter<TOptions, TResult> => ({
  ...adapter,
  start: async (ctx, source) => {
    const session = await adapter.start(ctx, source);
    if (session.complete) {
      broker.register({
        identity: completionIdentity(ctx),
        minLength: minLengthOf(source.options),
        session,
      });
    }
    return session;
  },
});

const completionIdentity = (ctx: InputSourceExecutionContext): InputCompletionIdentity => {
  if (!ctx.nodeExecutionId) {
    throw completionError(
      "inputCompletion.identityMissing",
      "Controlled input completion requires a node execution identity.",
    );
  }
  return {
    flowInstanceId: ctx.instanceId,
    interactionId: ctx.nodeExecutionId,
    nodeId: ctx.nodeId,
  };
};

const minLengthOf = (options: unknown): number => {
  if (!options || typeof options !== "object") return 0;
  const record = options as Record<string, unknown>;
  const value = record.minLength ?? record.minLen;
  return typeof value === "number" && Number.isSafeInteger(value) ? Math.max(0, value) : 0;
};

const matches = (session: InputSourceSession, request: InputCompletionRequest): boolean =>
  (!request.sourceId || request.sourceId === session.sourceId) &&
  (!request.sourceKind || request.sourceKind === session.sourceKind);

const identityKey = (identity: InputCompletionIdentity): string =>
  JSON.stringify([identity.flowInstanceId, identity.nodeId, identity.interactionId]);

const completionError = (code: string, message: string): FrameworkError =>
  new FrameworkError({ category: "dependency", code, message });
