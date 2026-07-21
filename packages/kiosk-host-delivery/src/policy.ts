import type { HostDeliveryPolicy } from "./contracts";

export class HostDeliveryPolicyRegistry {
  readonly #policies = new Map<string, HostDeliveryPolicy>();
  #frozen = false;

  public register(policy: HostDeliveryPolicy): this {
    if (this.#frozen) throw new Error("Host delivery policy registry is frozen");
    if (this.#policies.has(policy.id)) throw new Error(`Duplicate host delivery policy: ${policy.id}`);
    validate(policy);
    this.#policies.set(policy.id, Object.freeze({
      ...policy,
      retryDelaysMs: Object.freeze([...policy.retryDelaysMs]),
    }));
    return this;
  }

  public freeze(): this {
    this.#frozen = true;
    return this;
  }

  public require(id: string): HostDeliveryPolicy {
    const policy = this.#policies.get(id);
    if (!policy) throw new Error(`Host delivery policy is not registered: ${id}`);
    return policy;
  }
}

const validate = (policy: HostDeliveryPolicy): void => {
  if (!policy.id.trim() || !policy.version.trim()) throw new Error("Host delivery policy identity is required");
  if (!Number.isSafeInteger(policy.leaseMs) || policy.leaseMs <= 0) throw new Error(`Invalid lease duration: ${policy.id}`);
  if (!Number.isSafeInteger(policy.maxAttempts) || policy.maxAttempts <= 0) throw new Error(`Invalid max attempts: ${policy.id}`);
  if (policy.retryDelaysMs.length === 0 || policy.retryDelaysMs.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`Invalid retry delays: ${policy.id}`);
  }
};
