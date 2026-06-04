import { KioskError, type StepContext, type StepHandler } from "@tripley-acctron/contracts";
import { waitWithOptionalTimeout } from "./device-wait";
import type { EjectCardRecipe, WaitCardInsertedRecipe } from "./recipe-types";

export function waitCardInserted(definition: WaitCardInsertedRecipe): StepHandler {
  return async (ctx) => {
    try {
      const reader = requireCardReader(ctx, definition.id);
      const result = await waitWithOptionalTimeout(
        ctx,
        reader.waitForCard({ signal: ctx.scope.signal }),
        definition.timeout,
      );
      return result.type === "timeout"
        ? ctx.next(requireRoute(definition.routes.timeout, "timeout", definition.id))
        : ctx.next(definition.routes.inserted);
    } catch (error) {
      if (definition.routes.error) {
        ctx.logger.error("Wait card inserted recipe failed.", { stepId: definition.id, error });
        return ctx.next(definition.routes.error);
      }
      throw error;
    }
  };
}

export function ejectCard(definition: EjectCardRecipe): StepHandler {
  return async (ctx) => {
    try {
      const reader = requireCardReader(ctx, definition.id);
      if (definition.screen && ctx.ui) {
        await ctx.ui.show(definition.screen, {});
      }
      await ctx.voiceGuide?.play(definition.screen ?? "card.take");
      const options = Object.assign(
        { signal: ctx.scope.signal },
        definition.timeoutMs !== undefined ? { timeoutMs: definition.timeoutMs } : {},
      );
      const result = await ctx.scope.guard(reader.eject(options));
      if (result.taken) {
        return ctx.next(definition.routes.taken);
      }
      await reader.retain(definition.retainReason ?? "card.notTaken");
      return ctx.next(requireRoute(definition.routes.retained, "retained", definition.id));
    } catch (error) {
      if (definition.routes.failed) {
        ctx.logger.error("Eject card recipe failed.", { stepId: definition.id, error });
        return ctx.next(definition.routes.failed);
      }
      throw error;
    }
  };
}

function requireCardReader(ctx: StepContext, stepId: string) {
  if (!ctx.devices?.cardReader) {
    throw new KioskError("recipe.deviceMissing", `Recipe ${stepId} requires cardReader.`);
  }
  return ctx.devices.cardReader;
}

function requireRoute(route: string | undefined, routeName: string, stepId: string): string {
  if (!route) {
    throw new KioskError("recipe.routeMissing", `Recipe ${stepId} has no ${routeName} route.`);
  }
  return route;
}
