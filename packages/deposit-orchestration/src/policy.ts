import type {
  DepositEscrowReviewContext,
  DepositEscrowReviewGate,
  DepositEscrowReviewResult,
  DepositPolicy,
} from "./contracts";

export class DepositPolicyRegistry {
  readonly #policies = new Map<string, DepositPolicy>();
  #frozen = false;

  public register(policy: DepositPolicy): this {
    if (this.#frozen) throw new Error("Deposit policy registry is frozen");
    if (this.#policies.has(policy.id)) throw new Error(`Duplicate deposit policy: ${policy.id}`);
    validatePolicy(policy);
    this.#policies.set(policy.id, freezePolicy(policy));
    return this;
  }

  public freeze(): this {
    this.#frozen = true;
    return this;
  }

  public require(id: string): DepositPolicy {
    const policy = this.#policies.get(id);
    if (!policy) throw new Error(`Deposit policy is not registered: ${id}`);
    return policy;
  }
}

export class DepositEscrowReviewGateRegistry {
  readonly #gates = new Map<string, DepositEscrowReviewGate>();
  #frozen = false;

  public register(gate: DepositEscrowReviewGate): this {
    if (this.#frozen) throw new Error("Deposit review gate registry is frozen");
    if (this.#gates.has(gate.id)) throw new Error(`Duplicate deposit review gate: ${gate.id}`);
    this.#gates.set(gate.id, gate);
    return this;
  }

  public freeze(): this {
    this.#frozen = true;
    return this;
  }

  public evaluate(id: string, context: DepositEscrowReviewContext): Promise<DepositEscrowReviewResult> {
    const gate = this.#gates.get(id);
    if (!gate) throw new Error(`Deposit review gate is not registered: ${id}`);
    return gate.evaluate(context);
  }
}

const validatePolicy = (policy: DepositPolicy): void => {
  if (!policy.id.trim() || !policy.version.trim()) throw new Error("Deposit policy identity is required");
  if (!policy.logicalService.trim() || !policy.resourceGroup.trim()) {
    throw new Error(`Deposit XFS service and resource group are required: ${policy.id}`);
  }
  if (!Number.isSafeInteger(policy.maxBatches) || policy.maxBatches <= 0) {
    throw new Error(`Deposit maxBatches must be a positive integer: ${policy.id}`);
  }
  if (!policy.reviewGateId.trim()) throw new Error(`Deposit review gate is required: ${policy.id}`);
  if (!policy.hostProtocol.id.trim() || !policy.hostProtocol.version.trim()) {
    throw new Error(`Deposit host protocol identity is required: ${policy.id}`);
  }
};

const freezePolicy = (policy: DepositPolicy): DepositPolicy => Object.freeze({
  ...policy,
  acceptancePolicy: Object.freeze({ ...policy.acceptancePolicy }),
  hostProtocol: Object.freeze({ ...policy.hostProtocol }),
});
