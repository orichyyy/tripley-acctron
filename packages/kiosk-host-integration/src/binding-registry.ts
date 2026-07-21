import type { AnyHostMessageBinding, HostMessageBinding } from "./contracts";

export class HostMessageBindingRegistry {
  private readonly bindings = new Map<string, AnyHostMessageBinding>();
  private readonly messageTypes = new Map<string, AnyHostMessageBinding>();
  private frozen = false;

  public register<TRequest, TResponse>(binding: HostMessageBinding<TRequest, TResponse>): this {
    if (this.frozen) throw new Error("HostMessageBindingRegistry is frozen");
    if (!binding.id || !binding.version || binding.timeoutMs <= 0) {
      throw new Error("Host message binding identity or timeout is invalid");
    }
    if (this.bindings.has(binding.id) || this.messageTypes.has(binding.messageType)) {
      throw new Error(`Host message binding is already registered: ${binding.id}`);
    }
    const registered = binding as unknown as AnyHostMessageBinding;
    this.bindings.set(binding.id, registered);
    this.messageTypes.set(binding.messageType, registered);
    return this;
  }

  public freeze(): this {
    this.frozen = true;
    return this;
  }

  public require<TRequest, TResponse>(id: string): HostMessageBinding<TRequest, TResponse> {
    const binding = this.bindings.get(id);
    if (!binding) throw new Error(`Host message binding is not registered: ${id}`);
    return binding as unknown as HostMessageBinding<TRequest, TResponse>;
  }

  public requireMessageType(messageType: string): AnyHostMessageBinding {
    const binding = this.messageTypes.get(messageType);
    if (!binding) throw new Error(`Host message type is not registered: ${messageType}`);
    return binding;
  }
}
