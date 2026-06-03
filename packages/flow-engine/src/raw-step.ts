import type { StepHandler } from "@tripley-acctron/contracts";

export function defineRawStep(_id: string, handler: StepHandler): StepHandler {
  return handler;
}
