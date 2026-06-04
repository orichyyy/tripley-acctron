import type { InputSource, StepContext } from "@tripley-acctron/contracts";
import { defineTextInputStep, InputSources } from "@tripley-acctron/flow-engine";
import type { InputAccountRecipe } from "./recipe-types";

export function inputAccount(definition: InputAccountRecipe) {
  const stepDefinition = Object.assign(
    {
      id: definition.id,
      screen: definition.screen,
      audit: "customerInput" as const,
      voiceGuide: voiceGuideKey(definition),
      value: accountValueOptions(definition),
      sources: accountSources(definition),
      cancelRoute: "cancelled",
      commit: (ctx: StepContext, value: string) => {
        ctx.transaction?.set(definition.saveAs, value);
      },
      routes: accountRoutes(definition),
    },
    definition.timeout ? { timeout: definition.timeout } : {},
  );
  return defineTextInputStep(stepDefinition);
}

function voiceGuideKey(definition: InputAccountRecipe) {
  return definition.voiceGuide === undefined ? definition.screen : definition.voiceGuide;
}

function accountValueOptions(definition: InputAccountRecipe) {
  return Object.assign(
    { redactAs: "account" },
    definition.constraints?.minLength !== undefined
      ? { minLength: definition.constraints.minLength }
      : {},
    definition.constraints?.maxLength !== undefined
      ? { maxLength: definition.constraints.maxLength }
      : {},
  );
}

function accountRoutes(definition: InputAccountRecipe) {
  return Object.assign(
    { accepted: definition.routes.valid },
    definition.routes.cancel ? { cancelled: definition.routes.cancel } : {},
    definition.routes.timeout ? { timeout: definition.routes.timeout } : {},
    definition.routes.failed ? { failed: definition.routes.failed } : {},
  );
}

function accountSources(definition: InputAccountRecipe): InputSource[] {
  const sources = definition.sources ?? { pinpad: true, barcodeQr: false, uiActions: true };
  const result: InputSource[] = [];
  if (sources.pinpad) {
    result.push(InputSources.pinpad.numeric());
  }
  if (sources.barcodeQr) {
    const options =
      typeof sources.barcodeQr === "object" && sources.barcodeQr.parse
        ? { parse: sources.barcodeQr.parse }
        : {};
    result.push(InputSources.barcode.qr(options));
  }
  if (sources.uiActions) {
    result.push(InputSources.ui.action(definition.screen));
  }
  return result;
}
