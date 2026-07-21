export type HostExchangeFailureKind = "configuration" | "encode" | "delivery" | "decode";

export class HostExchangeError extends Error {
  public constructor(
    public readonly code: string,
    public readonly kind: HostExchangeFailureKind,
    public readonly outboxId?: string,
  ) {
    super(code);
    this.name = "HostExchangeError";
  }
}
