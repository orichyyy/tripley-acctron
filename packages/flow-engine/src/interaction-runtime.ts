import {
  KioskError,
  type DeviceManager,
  type InputSourceContext,
  type InputSourceSession,
  type InteractionAuditService,
  type InteractionIntent,
  type InteractionRunResult,
  type InteractionRuntimeOptions,
  type Logger,
  type RedactionService,
  type ScreenMap,
  type TimeoutHandle,
  type TimeoutResult,
  type TimeoutService,
  type UiPort,
} from "@tripley-acctron/contracts";
import { createInteractionReducerContext, isTerminalInteractionResult } from "./interaction-result";

export interface InteractionRuntimeDependencies<Screens extends ScreenMap> {
  ui: UiPort<Screens>;
  logger: Logger;
  devices?: DeviceManager;
  audit?: InteractionAuditService;
  redaction?: RedactionService;
  timeoutService?: TimeoutService;
  signal?: AbortSignal;
}

interface SourceRuntime {
  index: number;
  session: InputSourceSession;
  intent: Promise<SourceIntentResult | SourceIntentError>;
}

interface SourceIntentResult {
  sourceIndex: number;
  intent: InteractionIntent;
}

interface SourceIntentError {
  sourceIndex: number;
  error: unknown;
}

export class InteractionRuntime<Screens extends ScreenMap> {
  public constructor(private readonly dependencies: InteractionRuntimeDependencies<Screens>) {}

  public async run<TScreen extends keyof Screens, TState, TAccepted>(
    options: InteractionRuntimeOptions<Screens, TScreen, TState, TAccepted>,
  ): Promise<InteractionRunResult<TAccepted>> {
    const abort = new AbortController();
    const parentAbort = () => abort.abort(this.dependencies.signal?.reason);
    if (this.dependencies.signal?.aborted) {
      parentAbort();
    } else {
      this.dependencies.signal?.addEventListener("abort", parentAbort, { once: true });
    }
    const sourceContext = this.createSourceContext(abort.signal);
    const sessions = await this.startSources(options, sourceContext);
    const timeout = this.startTimeout(options, abort.signal);

    try {
      await this.dependencies.ui.show(options.screen, options.render(options.initialState));
      return await this.runLoop(options, sessions, timeout);
    } finally {
      abort.abort();
      this.dependencies.signal?.removeEventListener("abort", parentAbort);
      timeout?.cancel();
      await this.stopSources(sessions);
    }
  }

  private createSourceContext(signal: AbortSignal): InputSourceContext {
    return Object.assign(
      {
        signal,
        ui: this.dependencies.ui,
        logger: this.dependencies.logger,
      },
      this.dependencies.devices ? { devices: this.dependencies.devices } : {},
      this.dependencies.audit ? { audit: this.dependencies.audit } : {},
      this.dependencies.redaction ? { redaction: this.dependencies.redaction } : {},
    );
  }

  private async startSources<TScreen extends keyof Screens, TState, TAccepted>(
    options: InteractionRuntimeOptions<Screens, TScreen, TState, TAccepted>,
    ctx: InputSourceContext,
  ): Promise<SourceRuntime[]> {
    const sources = options.sources(options.initialState);
    const sessions = await Promise.all(sources.map((source) => source.start(ctx)));
    return sessions.map((session, index) => this.createSourceRuntime(index, session));
  }

  private startTimeout<TScreen extends keyof Screens, TState, TAccepted>(
    options: InteractionRuntimeOptions<Screens, TScreen, TState, TAccepted>,
    signal: AbortSignal,
  ): TimeoutHandle | undefined {
    if (!options.timeout) {
      return undefined;
    }
    if (!this.dependencies.timeoutService) {
      throw new KioskError("interaction.runtime", "Interaction timeout requires TimeoutService.");
    }
    return this.dependencies.timeoutService.start({ ...options.timeout, signal });
  }

  private async runLoop<TScreen extends keyof Screens, TState, TAccepted>(
    options: InteractionRuntimeOptions<Screens, TScreen, TState, TAccepted>,
    sources: SourceRuntime[],
    timeout: TimeoutHandle | undefined,
  ): Promise<InteractionRunResult<TAccepted>> {
    let state = options.initialState;
    let activeTimeout = timeout;

    while (true) {
      const result = await this.waitNextIntent(sources, activeTimeout);
      if ("timeout" in result) {
        if (result.timeout.type === "continue") {
          activeTimeout = this.restartTimeout(options, result.timeout);
          continue;
        }
        return { type: "timeout" };
      }

      if ("error" in result) {
        throw new KioskError(
          "interaction.runtime",
          "Input source failed while waiting.",
          result.error,
        );
      }

      const source = sources[result.sourceIndex];
      if (!source) {
        throw new KioskError("interaction.runtime", "Input source index was not found.");
      }
      sources[result.sourceIndex] = this.createSourceRuntime(result.sourceIndex, source.session);
      await options.auditIntent?.(result.intent);
      activeTimeout?.reset();

      const reduced = await options.reduce(
        state,
        result.intent,
        createInteractionReducerContext<TState, TAccepted>(),
      );
      if (isTerminalInteractionResult(reduced)) {
        return reduced;
      }

      state = reduced.state;
      await this.dependencies.ui.patch(options.screen, options.render(state));
    }
  }

  private async waitNextIntent(
    sources: SourceRuntime[],
    timeout: TimeoutHandle | undefined,
  ): Promise<SourceIntentResult | SourceIntentError | { timeout: TimeoutResult }> {
    const tasks: Array<
      Promise<SourceIntentResult | SourceIntentError | { timeout: TimeoutResult }>
    > = sources.map((source) => source.intent);
    if (timeout) {
      tasks.push(timeout.result.then((result) => ({ timeout: result })));
    }
    return Promise.race(tasks);
  }

  private restartTimeout<TScreen extends keyof Screens, TState, TAccepted>(
    options: InteractionRuntimeOptions<Screens, TScreen, TState, TAccepted>,
    result: Extract<TimeoutResult, { type: "continue" }>,
  ): TimeoutHandle | undefined {
    if (!options.timeout || !this.dependencies.timeoutService) {
      return undefined;
    }
    return this.dependencies.timeoutService.start({
      ...options.timeout,
      durationMs: result.extensionMs,
    });
  }

  private createSourceRuntime(index: number, session: InputSourceSession): SourceRuntime {
    return {
      index,
      session,
      intent: session
        .next()
        .then((intent) => ({ sourceIndex: index, intent }))
        .catch((error: unknown) => ({ sourceIndex: index, error })),
    };
  }

  private async stopSources(sources: SourceRuntime[]): Promise<void> {
    const errors: unknown[] = [];
    for (const source of [...sources].reverse()) {
      try {
        await source.session.stop();
      } catch (error) {
        errors.push(error);
        this.dependencies.logger.error("Input source stop failed.", {
          sourceIndex: source.index,
          error,
        });
      }
    }
    if (errors.length > 0) {
      throw new KioskError(
        "interaction.runtime",
        "One or more input sources failed to stop.",
        errors[0],
      );
    }
  }
}
