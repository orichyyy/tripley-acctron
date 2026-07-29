import type {
  WithdrawalPolicy,
  WithdrawalPrePresentGate,
  WithdrawalPrePresentGateContext,
  WithdrawalPrePresentGateResult,
} from "./contracts";

export class WithdrawalPolicyRegistry {
  readonly #policies = new Map<string, WithdrawalPolicy>();
  #frozen = false;

  public register(policy: WithdrawalPolicy): this {
    if (this.#frozen) throw new Error("Withdrawal policy registry is frozen");
    if (this.#policies.has(policy.id)) throw new Error(`Duplicate withdrawal policy: ${policy.id}`);
    validatePolicy(policy);
    this.#policies.set(policy.id, freezePolicy(policy));
    return this;
  }

  public freeze(): this {
    this.#frozen = true;
    return this;
  }

  public require(id: string): WithdrawalPolicy {
    const policy = this.#policies.get(id);
    if (!policy) throw new Error(`Withdrawal policy is not registered: ${id}`);
    return policy;
  }
}

export class WithdrawalPrePresentGateRegistry {
  readonly #gates = new Map<string, WithdrawalPrePresentGate>();
  #frozen = false;

  public register(gate: WithdrawalPrePresentGate): this {
    if (this.#frozen) throw new Error("Withdrawal gate registry is frozen");
    if (this.#gates.has(gate.id)) throw new Error(`Duplicate withdrawal gate: ${gate.id}`);
    this.#gates.set(gate.id, gate);
    return this;
  }

  public freeze(): this {
    this.#frozen = true;
    return this;
  }

  public async evaluate(
    gateIds: readonly string[],
    context: WithdrawalPrePresentGateContext,
  ): Promise<WithdrawalPrePresentGateResult> {
    for (const id of gateIds) {
      const gate = this.#gates.get(id);
      if (!gate) throw new Error(`Withdrawal gate is not registered: ${id}`);
      const result = await gate.evaluate(context);
      if (result.status !== "approved") return result;
    }
    return { status: "approved" };
  }
}

const validatePolicy = (policy: WithdrawalPolicy): void => {
  if (!policy.id.trim() || !policy.version.trim()) throw new Error("Withdrawal policy identity is required");
  if (policy.allowedEntryModes.length === 0) throw new Error("Withdrawal policy requires an entry mode");
  if (new Set(policy.allowedEntryModes).size !== policy.allowedEntryModes.length) {
    throw new Error(`Withdrawal policy has duplicate entry modes: ${policy.id}`);
  }
  if (new Set(policy.prePresentGateIds).size !== policy.prePresentGateIds.length) {
    throw new Error(`Withdrawal policy has duplicate pre-present gates: ${policy.id}`);
  }
  if (
    policy.allowedEntryModes.includes("contact-card") &&
    policy.cardOrder !== "managed-by-parent-session" &&
    !policy.cardCustodyPolicyId?.trim()
  ) {
    throw new Error(`Contact-card withdrawal policy requires card custody: ${policy.id}`);
  }
  if (!policy.hostProtocol.id.trim() || !policy.hostProtocol.version.trim()) {
    throw new Error(`Withdrawal host protocol identity is required: ${policy.id}`);
  }
};

const freezePolicy = (policy: WithdrawalPolicy): WithdrawalPolicy => Object.freeze({
  ...policy,
  allowedEntryModes: Object.freeze([...policy.allowedEntryModes]),
  hostProtocol: Object.freeze({ ...policy.hostProtocol }),
  prePresentGateIds: Object.freeze([...policy.prePresentGateIds]),
  presentationPolicy: Object.freeze({
    ...policy.presentationPolicy,
    requiredGates: Object.freeze([...policy.presentationPolicy.requiredGates]),
  }),
});
