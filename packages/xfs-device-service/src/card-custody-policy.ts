import { FrameworkError } from "@tripley-kit/web-container-errors";

import type { CardCustodyPolicy } from "./card-custody-contracts";

export class CardCustodyPolicyRegistry {
  private readonly policies = new Map<string, CardCustodyPolicy>();
  private frozen = false;

  public register(policy: CardCustodyPolicy): this {
    validatePolicy(policy);
    if (this.frozen || this.policies.has(policy.id)) {
      throw policyError("card.custody.policy.registrationRejected", policy.id);
    }
    this.policies.set(policy.id, Object.freeze({
      ...policy,
      ...(policy.interruptActions
        ? { interruptActions: Object.freeze({ ...policy.interruptActions }) }
        : {}),
    }));
    return this;
  }

  public freeze(): this {
    this.frozen = true;
    return this;
  }

  public require(id: string): CardCustodyPolicy {
    const policy = this.policies.get(id);
    if (!policy) throw policyError("card.custody.policy.missing", id);
    return policy;
  }
}

const validatePolicy = (policy: CardCustodyPolicy): void => {
  if (!policy.id.trim() || !policy.version.trim()) {
    throw policyError("card.custody.policy.invalid", policy.id);
  }
  if (!Number.isSafeInteger(policy.takeTimeoutMs) || policy.takeTimeoutMs <= 0) {
    throw policyError("card.custody.policy.invalidTakeTimeout", policy.id);
  }
  if (!Number.isSafeInteger(policy.pollIntervalMs) || policy.pollIntervalMs <= 0) {
    throw policyError("card.custody.policy.invalidPollInterval", policy.id);
  }
};

const policyError = (code: string, id: string): FrameworkError =>
  new FrameworkError({
    category: "configuration",
    code,
    message: `Card custody policy rejected: ${id}`,
    metadata: { id },
  });

