import { KioskError, type StepHandler } from "@tripley-acctron/contracts";

export class StepRegistry {
  private readonly steps = new Map<string, StepHandler>();

  public register(id: string, step: StepHandler): void {
    if (this.steps.has(id)) {
      throw new KioskError("flow.compile", `Step ${id} has already been registered.`);
    }
    this.steps.set(id, step);
  }

  public get(id: string): StepHandler {
    const step = this.steps.get(id);
    if (!step) {
      throw new KioskError("flow.stepMissing", `Step ${id} was not registered.`);
    }
    return step;
  }

  public static fromRecord(steps: Record<string, StepHandler>): StepRegistry {
    const registry = new StepRegistry();
    for (const [id, step] of Object.entries(steps)) {
      registry.register(id, step);
    }
    return registry;
  }
}
