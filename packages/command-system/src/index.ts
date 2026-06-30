import type { ConditionRegistry, ConditionResult } from "@tripley/web-container-condition-engine";
import { FrameworkError } from "@tripley/web-container-errors";
import type { TtsPort } from "@tripley/web-container-tts";
import type { UiPort, UiStateScope } from "@tripley/web-container-ui-port";

export const commandSystemPackageName = "@tripley/web-container-command-system";

export interface Command<TInput = unknown, TResult = unknown> {
  readonly id: string;
  readonly title?: string | undefined;
  canExecute?(
    ctx: CommandContext,
    input: TInput,
  ): boolean | CommandCanExecuteResult | Promise<boolean | CommandCanExecuteResult>;
  execute(ctx: CommandContext, input: TInput): Promise<TResult>;
  readonly options?: CommandOptions | undefined;
}

export interface CommandOptions {
  readonly disableWhileRunning?: boolean | undefined;
  readonly showLoadingWhileRunning?: boolean | undefined;
  readonly debounceMs?: number | undefined;
  readonly throttleMs?: number | undefined;
  readonly idempotencyKey?: string | ((input: unknown) => string) | undefined;
  readonly confirm?: CommandConfirmOptions | undefined;
  readonly audit?: CommandAuditOptions | undefined;
  readonly tts?: CommandTtsOptions | undefined;
}

export interface CommandConfirmOptions {
  readonly messageKey?: string | undefined;
  readonly text?: string | undefined;
}

export interface CommandAuditOptions {
  readonly eventId: string;
  readonly text?: string | undefined;
}

export interface CommandTtsOptions {
  readonly text: string;
  readonly mode?: "queue" | "interrupt" | "replace" | undefined;
}

export interface CommandContext {
  readonly conditions?: ConditionRegistry | undefined;
  readonly ui?: UiPort | undefined;
  readonly tts?: TtsPort | undefined;
  readonly uiScope?: UiStateScope | undefined;
  readonly now?: (() => number) | undefined;
  readonly idempotency?: CommandIdempotencyStore | undefined;
  readonly [key: string]: unknown;
}

export interface CommandIdempotencyStore {
  get<TResult = unknown>(key: string): Promise<TResult | undefined> | TResult | undefined;
  set<TResult = unknown>(key: string, result: TResult): Promise<void> | void;
}

export interface CommandMiddleware {
  readonly id: string;
  beforeExecute?(ctx: CommandContext, command: Command, input: unknown): Promise<void>;
  afterExecute?(ctx: CommandContext, command: Command, result: unknown): Promise<void>;
  onError?(ctx: CommandContext, command: Command, error: unknown): Promise<void>;
}

export interface CommandCanExecuteResult {
  readonly allowed: boolean;
  readonly reasonCode?: string | undefined;
  readonly message?: string | undefined;
  readonly messageKey?: string | undefined;
}

export interface CommandExecutionState {
  readonly running: boolean;
  readonly loading: boolean;
  readonly disabled: boolean;
  readonly lastStartedAt?: number | undefined;
  readonly lastFinishedAt?: number | undefined;
}

export class CommandRegistry {
  private readonly commands = new Map<string, Command>();
  private readonly middleware: CommandMiddleware[] = [];
  private readonly running = new Map<string, Promise<unknown>>();
  private readonly completedIdempotency = new Map<string, unknown>();
  private readonly lastAttemptAt = new Map<string, number>();
  private readonly lastStartedAt = new Map<string, number>();

  public register(command: Command): void {
    if (this.commands.has(command.id)) {
      throw new FrameworkError({
        category: "extension",
        code: "command.duplicate",
        message: `Command already registered: ${command.id}`,
        metadata: { commandId: command.id },
      });
    }

    this.commands.set(command.id, command);
  }

  public registerMiddleware(middleware: CommandMiddleware): void {
    if (this.middleware.some((candidate) => candidate.id === middleware.id)) {
      throw new FrameworkError({
        category: "extension",
        code: "command.middleware.duplicate",
        message: `Command middleware already registered: ${middleware.id}`,
        metadata: { middlewareId: middleware.id },
      });
    }

    this.middleware.push(middleware);
  }

  public get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  public require(id: string): Command {
    const command = this.commands.get(id);
    if (!command) {
      throw new FrameworkError({
        category: "extension",
        code: "command.missing",
        message: `Command is not registered: ${id}`,
        metadata: { commandId: id },
      });
    }

    return command;
  }

  public async canExecute<TInput = unknown>(
    commandId: string,
    ctx: CommandContext,
    input: TInput,
  ): Promise<CommandCanExecuteResult> {
    const command = this.require(commandId) as Command<TInput>;
    if (!command.canExecute) {
      return { allowed: true };
    }

    const result = await command.canExecute(ctx, input);
    if (typeof result === "boolean") {
      return { allowed: result };
    }

    return result;
  }

  public async execute<TInput = unknown, TResult = unknown>(
    commandId: string,
    ctx: CommandContext,
    input: TInput,
  ): Promise<TResult> {
    const command = this.require(commandId) as Command<TInput, TResult>;
    const now = ctx.now?.() ?? Date.now();
    enforceTiming(command, now, this.lastAttemptAt, this.lastStartedAt);
    this.lastAttemptAt.set(command.id, now);

    const idempotencyKey = resolveIdempotencyKey(command, input);
    if (idempotencyKey) {
      const stored =
        (await ctx.idempotency?.get<TResult>(idempotencyKey)) ??
        (this.completedIdempotency.get(idempotencyKey) as TResult | undefined);
      if (stored !== undefined) {
        return stored;
      }

      const running = this.running.get(idempotencyKey);
      if (running) {
        return running as Promise<TResult>;
      }
    }

    if (command.options?.disableWhileRunning && this.running.has(command.id)) {
      throw new FrameworkError({
        category: "dependency",
        code: "command.running",
        message: `Command is already running: ${command.id}`,
        metadata: { commandId: command.id },
      });
    }

    const canExecute = await this.canExecute(commandId, ctx, input);
    if (!canExecute.allowed) {
      throw new FrameworkError({
        category: "dependency",
        code: "command.blocked",
        message: `Command cannot execute: ${command.id}`,
        metadata: { commandId: command.id, reasonCode: canExecute.reasonCode ?? "blocked" },
      });
    }

    const execution = this.executeWithMiddleware(command, ctx, input, idempotencyKey);
    this.running.set(command.id, execution);
    if (idempotencyKey) {
      this.running.set(idempotencyKey, execution);
    }

    return execution;
  }

  public getState(commandId: string): CommandExecutionState {
    return {
      disabled: this.running.has(commandId),
      lastStartedAt: this.lastStartedAt.get(commandId),
      loading: this.running.has(commandId),
      running: this.running.has(commandId),
    };
  }

  public list(): Command[] {
    return [...this.commands.values()];
  }

  private async executeWithMiddleware<TInput, TResult>(
    command: Command<TInput, TResult>,
    ctx: CommandContext,
    input: TInput,
    idempotencyKey: string | undefined,
  ): Promise<TResult> {
    this.lastStartedAt.set(command.id, ctx.now?.() ?? Date.now());
    setCommandUiState(ctx, command, true);

    try {
      for (const middleware of this.middleware) {
        await middleware.beforeExecute?.(ctx, command, input);
      }

      const result = await command.execute(ctx, input);

      for (const middleware of [...this.middleware].reverse()) {
        await middleware.afterExecute?.(ctx, command, result);
      }

      if (command.options?.tts) {
        await ctx.tts?.speak(command.options.tts.text, { mode: command.options.tts.mode });
      }

      if (idempotencyKey) {
        this.completedIdempotency.set(idempotencyKey, result);
        await ctx.idempotency?.set(idempotencyKey, result);
      }

      return result;
    } catch (error) {
      for (const middleware of [...this.middleware].reverse()) {
        await middleware.onError?.(ctx, command, error);
      }
      throw error;
    } finally {
      this.running.delete(command.id);
      if (idempotencyKey) {
        this.running.delete(idempotencyKey);
      }
      setCommandUiState(ctx, command, false);
    }
  }
}

export const canExecuteCommand = async (
  registry: CommandRegistry,
  commandId: string,
  ctx: CommandContext,
  input?: unknown,
): Promise<CommandCanExecuteResult> => registry.canExecute(commandId, ctx, input);

export const conditionResultToCommandResult = (
  result: ConditionResult,
): CommandCanExecuteResult => ({
  allowed: result.allowed,
  message: result.message,
  messageKey: result.messageKey,
  reasonCode: result.reasonCode,
});

const enforceTiming = (
  command: Command,
  now: number,
  lastAttemptAt: Map<string, number>,
  lastStartedAt: Map<string, number>,
): void => {
  const previousAttempt = lastAttemptAt.get(command.id);
  if (
    command.options?.debounceMs !== undefined &&
    previousAttempt !== undefined &&
    now - previousAttempt < command.options.debounceMs
  ) {
    throw new FrameworkError({
      category: "dependency",
      code: "command.debounced",
      message: `Command was debounced: ${command.id}`,
      metadata: { commandId: command.id },
    });
  }

  const previousStart = lastStartedAt.get(command.id);
  if (
    command.options?.throttleMs !== undefined &&
    previousStart !== undefined &&
    now - previousStart < command.options.throttleMs
  ) {
    throw new FrameworkError({
      category: "dependency",
      code: "command.throttled",
      message: `Command was throttled: ${command.id}`,
      metadata: { commandId: command.id },
    });
  }
};

const resolveIdempotencyKey = (command: Command, input: unknown): string | undefined => {
  const key = command.options?.idempotencyKey;
  if (typeof key === "function") {
    return key(input);
  }

  return key;
};

const setCommandUiState = (ctx: CommandContext, command: Command, running: boolean): void => {
  if (
    !ctx.ui ||
    (!command.options?.showLoadingWhileRunning && !command.options?.disableWhileRunning)
  ) {
    return;
  }

  ctx.ui.setState(ctx.uiScope ?? {}, `command.${command.id}`, {
    disabled: command.options?.disableWhileRunning ? running : false,
    loading: command.options?.showLoadingWhileRunning ? running : false,
    running,
  });
};
