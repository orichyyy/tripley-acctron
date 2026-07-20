import { FrameworkError } from "@tripley-kit/web-container-errors";
import type { MaybePromise } from "@tripley-kit/web-container-types";

export const conditionEnginePackageName = "@tripley-kit/web-container-condition-engine";

export interface ConditionContext {
  readonly input?: unknown;
  readonly clock?: { now(): Date };
  readonly services?: ReadonlyMap<string, unknown> | Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface ConditionResult {
  readonly allowed: boolean;
  readonly reasonCode?: string | undefined;
  readonly message?: string | undefined;
  readonly messageKey?: string | undefined;
  readonly data?: Record<string, unknown> | undefined;
}

export interface Condition<TInput = unknown> {
  readonly id: string;
  evaluate(ctx: ConditionContext, input?: TInput): MaybePromise<boolean | ConditionResult>;
}

export type ConditionExpression =
  | string
  | readonly string[]
  | ((ctx: ConditionContext) => MaybePromise<boolean | ConditionResult>)
  | undefined;

export interface ConditionRegistrationOptions {
  readonly ownerPluginId?: string | undefined;
  readonly duplicatePolicy?: "reject" | "replace" | "ignore" | undefined;
}

export interface ConditionSnapshot {
  readonly id: string;
  readonly ownerPluginId?: string | undefined;
}

export class ConditionRegistry {
  private readonly conditions = new Map<string, Condition>();
  private readonly owners = new Map<string, string>();

  public register(condition: Condition, options: ConditionRegistrationOptions = {}): void {
    if (this.conditions.has(condition.id)) {
      const duplicatePolicy = options.duplicatePolicy ?? "reject";
      if (duplicatePolicy === "ignore") {
        return;
      }

      if (duplicatePolicy !== "replace") {
        throw new FrameworkError({
          category: "extension",
          code: "condition.duplicate",
          message: `Condition already registered: ${condition.id}`,
          metadata: { conditionId: condition.id },
        });
      }
    }

    this.conditions.set(condition.id, condition);
    if (options.ownerPluginId !== undefined) {
      this.owners.set(condition.id, options.ownerPluginId);
    }
  }

  public get(id: string): Condition | undefined {
    return this.conditions.get(id);
  }

  public require(id: string): Condition {
    const condition = this.conditions.get(id);
    if (!condition) {
      throw new FrameworkError({
        category: "extension",
        code: "condition.missing",
        message: `Condition is not registered: ${id}`,
        metadata: { conditionId: id },
      });
    }

    return condition;
  }

  public async evaluate<TInput = unknown>(
    id: string,
    ctx: ConditionContext,
    input?: TInput,
  ): Promise<ConditionResult> {
    const condition = this.require(id);
    const result = await condition.evaluate(ctx, input);
    return normalizeConditionResult(result);
  }

  public async evaluateBoolean<TInput = unknown>(
    id: string,
    ctx: ConditionContext,
    input?: TInput,
  ): Promise<boolean> {
    return (await this.evaluate(id, ctx, input)).allowed;
  }

  public async evaluateAll(
    expression: ConditionExpression,
    ctx: ConditionContext,
  ): Promise<ConditionResult> {
    if (expression === undefined) {
      return { allowed: true };
    }

    if (typeof expression === "function") {
      return normalizeConditionResult(await expression(ctx));
    }

    const ids = Array.isArray(expression) ? expression : [expression];
    for (const id of ids) {
      const result = await this.evaluate(id, ctx);
      if (!result.allowed) {
        return result;
      }
    }

    return { allowed: true };
  }

  public list(): ConditionSnapshot[] {
    return [...this.conditions.keys()].sort().map((id) => ({
      id,
      ownerPluginId: this.owners.get(id),
    }));
  }
}

export const normalizeConditionResult = (result: boolean | ConditionResult): ConditionResult => {
  if (typeof result === "boolean") {
    return { allowed: result };
  }

  return result;
};

export const visibleWhen = async (
  registry: ConditionRegistry,
  expression: ConditionExpression,
  ctx: ConditionContext,
): Promise<boolean> => registry.evaluateAll(expression, ctx).then((result) => result.allowed);

export const enabledWhen = async (
  registry: ConditionRegistry,
  expression: ConditionExpression,
  ctx: ConditionContext,
): Promise<boolean> => registry.evaluateAll(expression, ctx).then((result) => result.allowed);

export const canExecuteWhen = async (
  registry: ConditionRegistry,
  expression: ConditionExpression,
  ctx: ConditionContext,
): Promise<ConditionResult> => registry.evaluateAll(expression, ctx);
