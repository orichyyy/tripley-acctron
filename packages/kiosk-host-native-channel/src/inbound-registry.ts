import type {
  HostInboundDispatchResult,
  HostInboundMessage,
  HostInboundMessageContext,
  HostInboundMessageHandler,
} from "./persistent-contracts";

export class HostInboundMessageRegistry {
  private readonly handlers = new Map<string, HostInboundMessageHandler>();
  private frozen = false;

  public register(handler: HostInboundMessageHandler): this {
    if (this.frozen) throw new Error("HostInboundMessageRegistry is frozen");
    if (!handler.id || !handler.type || this.handlers.has(handler.type)) {
      throw new Error(`Host inbound message handler is already registered: ${handler.type}`);
    }
    this.handlers.set(handler.type, handler);
    return this;
  }

  public freeze(): this {
    this.frozen = true;
    return this;
  }

  public async dispatch(
    message: HostInboundMessage,
    context: HostInboundMessageContext,
  ): Promise<HostInboundDispatchResult> {
    const handler = this.handlers.get(message.type);
    if (!handler) return { status: "unhandled" };
    try {
      await handler.handle(message, context);
      return { handlerId: handler.id, status: "handled" };
    } catch {
      return {
        errorCode: "host.session.inbound-handler-failed",
        handlerId: handler.id,
        status: "failed",
      };
    }
  }
}
