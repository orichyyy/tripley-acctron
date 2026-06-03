export type KioskErrorCode =
  | "service.notFound"
  | "service.duplicate"
  | "bus.handlerMissing"
  | "bus.handlerDuplicate"
  | "plugin.duplicate"
  | "plugin.dependencyMissing"
  | "flow.compile"
  | "flow.stepMissing"
  | "interaction.sourceMissing"
  | "interaction.runtime"
  | "recovery.failed"
  | "scope.disposed"
  | "native.unavailable";

export class KioskError extends Error {
  public constructor(
    public readonly code: KioskErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "KioskError";
  }
}

export class ScopeDisposedError extends KioskError {
  public constructor() {
    super("scope.disposed", "Step scope has already been disposed.");
    this.name = "ScopeDisposedError";
  }
}
