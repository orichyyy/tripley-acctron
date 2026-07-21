import type { HostWireTransportAdapter } from "./contracts";

export class HostWireTransportRegistry {
  private readonly adapters = new Map<string, HostWireTransportAdapter>();
  private frozen = false;

  public register(adapter: HostWireTransportAdapter): this {
    if (this.frozen) throw new Error("HostWireTransportRegistry is frozen");
    if (!adapter.id || this.adapters.has(adapter.id)) {
      throw new Error(`Host wire transport is already registered: ${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
    return this;
  }

  public freeze(): this {
    this.frozen = true;
    return this;
  }

  public require(id: string): HostWireTransportAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`Host wire transport is not registered: ${id}`);
    return adapter;
  }
}
