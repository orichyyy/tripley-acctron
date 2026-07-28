import { FrameworkError } from "@tripley-kit/web-container-errors";

import type {
  InputSourceAdapter,
  InputSourceExecutionContext,
  InputSourceKind,
  InputSourceSession,
  UserInputSourceDefinition,
  UserInputSourceResult,
} from "./input-sources";

export interface InputInteractionIdentity {
  readonly channelId: string;
  readonly flowInstanceId: string;
  readonly nodeId: string;
  readonly interactionId: string;
}

export interface CorrelatedProgrammaticInputOptions {
  readonly identity: InputInteractionIdentity;
  readonly allowedIntentIds: readonly string[];
}

export interface CorrelatedInputSubmission {
  readonly identity: InputInteractionIdentity;
  readonly intentId: string;
  readonly payload?: unknown;
}

export interface ProgrammaticInputResult<TPayload = unknown>
  extends UserInputSourceResult<TPayload> {
  readonly kind: "programmaticIntent";
}

export interface CorrelatedInputAdapterOptions<
  TResult extends UserInputSourceResult,
> {
  readonly kind?: InputSourceKind | undefined;
  mapResult?(
    submission: CorrelatedInputSubmission,
    source: UserInputSourceDefinition<CorrelatedProgrammaticInputOptions>,
  ): TResult;
}

export interface CorrelatedInputSourceBrokerOptions {
  readonly completedInteractionRetention?: number | undefined;
}

interface PendingInput<TResult extends UserInputSourceResult> {
  readonly options: CorrelatedProgrammaticInputOptions;
  readonly source: UserInputSourceDefinition<CorrelatedProgrammaticInputOptions>;
  readonly mapResult: NonNullable<
    CorrelatedInputAdapterOptions<TResult>["mapResult"]
  >;
  readonly resolve: (result: TResult) => void;
  readonly reject: (error: unknown) => void;
}

export class CorrelatedInputSourceBroker {
  private readonly pending = new Map<
    string,
    PendingInput<UserInputSourceResult>
  >();
  private readonly completed = new Map<
    string,
    "completed" | "cancelled"
  >();
  private readonly retention: number;

  public constructor(options: CorrelatedInputSourceBrokerOptions = {}) {
    this.retention = Math.max(
      0,
      Math.floor(options.completedInteractionRetention ?? 100),
    );
  }

  public createAdapter<
    TResult extends UserInputSourceResult = ProgrammaticInputResult,
  >(
    options: CorrelatedInputAdapterOptions<TResult> = {},
  ): InputSourceAdapter<CorrelatedProgrammaticInputOptions, TResult> {
    const kind = options.kind ?? "ui.command";
    const mapResult =
      options.mapResult ??
      (defaultProgrammaticResult as NonNullable<
        CorrelatedInputAdapterOptions<TResult>["mapResult"]
      >);
    return {
      canStart: () => true,
      kind,
      start: async (ctx, source) =>
        this.start(ctx, source, mapResult),
      validateDefinition: (source) => {
        correlatedOptions(source.options);
      },
    };
  }

  public submit(submission: CorrelatedInputSubmission): void {
    const pending = this.pending.get(submission.identity.channelId);
    const key = identityKey(submission.identity);
    if (!pending) {
      throw programmaticError(
        this.completed.has(key)
          ? "programmaticInput.duplicate"
          : "programmaticInput.noPending",
        "No matching programmatic input interaction is pending.",
      );
    }
    if (!sameIdentity(pending.options.identity, submission.identity)) {
      throw programmaticError(
        "programmaticInput.stale",
        "Programmatic input belongs to a stale interaction.",
      );
    }
    if (!pending.options.allowedIntentIds.includes(submission.intentId)) {
      throw programmaticError(
        "programmaticInput.intentNotAllowed",
        `Intent is not allowed for the active interaction: ${submission.intentId}`,
      );
    }

    const result = pending.mapResult(submission, pending.source);
    this.pending.delete(submission.identity.channelId);
    this.remember(submission.identity, "completed");
    pending.resolve(result);
  }

  public requireActiveIdentity(channelId: string): InputInteractionIdentity {
    const identity = this.pending.get(channelId)?.options.identity;
    if (!identity) {
      throw programmaticError(
        "programmaticInput.noPending",
        `No programmatic input is pending for channel: ${channelId}`,
      );
    }
    return identity;
  }

  public get completedInteractionCount(): number {
    return this.completed.size;
  }

  private start<TResult extends UserInputSourceResult>(
    ctx: InputSourceExecutionContext,
    source: UserInputSourceDefinition<CorrelatedProgrammaticInputOptions>,
    mapResult: NonNullable<
      CorrelatedInputAdapterOptions<TResult>["mapResult"]
    >,
  ): InputSourceSession<TResult> {
    const options = correlatedOptions(source.options);
    assertContextIdentity(ctx, options.identity);
    const channelId = options.identity.channelId;
    if (this.pending.has(channelId)) {
      throw programmaticError(
        "programmaticInput.channelBusy",
        `Programmatic input channel is already active: ${channelId}`,
      );
    }
    if (this.completed.has(identityKey(options.identity))) {
      throw programmaticError(
        "programmaticInput.identityReused",
        "Programmatic input interaction identity has already completed.",
      );
    }

    let pending!: PendingInput<TResult>;
    const result = new Promise<TResult>((resolve, reject) => {
      pending = { mapResult, options, reject, resolve, source };
    });
    this.pending.set(
      channelId,
      pending as unknown as PendingInput<UserInputSourceResult>,
    );

    return {
      cancel: async (reason) => {
        const active = this.pending.get(channelId);
        if (
          !active ||
          !sameIdentity(active.options.identity, options.identity)
        ) {
          return;
        }
        this.pending.delete(channelId);
        this.remember(options.identity, "cancelled");
        active.reject(
          programmaticError(
            reason ?? "programmaticInput.cancelled",
            "Programmatic input interaction was cancelled.",
          ),
        );
      },
      id: identityKey(options.identity),
      result,
      sourceId: source.id,
      sourceKind: source.kind,
    };
  }

  private remember(
    identity: InputInteractionIdentity,
    status: "completed" | "cancelled",
  ): void {
    if (this.retention === 0) {
      return;
    }
    this.completed.set(identityKey(identity), status);
    while (this.completed.size > this.retention) {
      const oldest = this.completed.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.completed.delete(oldest);
    }
  }
}

const defaultProgrammaticResult = (
  submission: CorrelatedInputSubmission,
  source: UserInputSourceDefinition<CorrelatedProgrammaticInputOptions>,
): ProgrammaticInputResult => ({
  kind: "programmaticIntent",
  safeSummary: {
    hasPayload: submission.payload !== undefined,
    intentId: submission.intentId,
    sourceKind: source.kind,
  },
  source: {
    ...(source.deviceId ? { deviceId: source.deviceId } : {}),
    id: source.id,
    kind: source.kind,
  },
  value: submission.payload,
});

const correlatedOptions = (
  value: CorrelatedProgrammaticInputOptions | undefined,
): CorrelatedProgrammaticInputOptions => {
  if (
    !value ||
    !value.identity.channelId ||
    !value.identity.flowInstanceId ||
    !value.identity.nodeId ||
    !value.identity.interactionId ||
    value.allowedIntentIds.length === 0
  ) {
    throw programmaticError(
      "programmaticInput.definitionInvalid",
      "Correlated programmatic input requires identity and allowed intents.",
    );
  }
  return value;
};

const assertContextIdentity = (
  ctx: InputSourceExecutionContext,
  identity: InputInteractionIdentity,
): void => {
  if (
    identity.flowInstanceId !== ctx.instanceId ||
    identity.nodeId !== ctx.nodeId
  ) {
    throw programmaticError(
      "programmaticInput.contextMismatch",
      "Programmatic input identity does not match the active Flow node.",
    );
  }
};

const sameIdentity = (
  left: InputInteractionIdentity,
  right: InputInteractionIdentity,
): boolean => identityKey(left) === identityKey(right);

const identityKey = (identity: InputInteractionIdentity): string =>
  JSON.stringify(identity);

const programmaticError = (
  code: string,
  message: string,
): FrameworkError =>
  new FrameworkError({
    category: "dependency",
    code,
    message,
  });
