import { FrameworkError } from "@tripley-kit/web-container-errors";

export interface CashPresentationGateContext {
  readonly operationId: string;
  readonly cashSessionId: string;
}

export interface CashPresentationGate {
  readonly id: string;
  evaluate(context: CashPresentationGateContext): boolean | Promise<boolean>;
}

export interface CashPresentationPolicy {
  readonly id: string;
  readonly version: string;
  readonly requiredGates: readonly string[];
  readonly authorizationTtlMs: number;
  readonly takeTimeoutMs: number;
}

export interface CashPresentationAuthorization {
  readonly id: string;
  readonly operationId: string;
  readonly cashSessionId: string;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly satisfiedGates: readonly string[];
  readonly expiresAt: number;
}

export class CashPresentationGateRegistry {
  private readonly gates = new Map<string, CashPresentationGate>();
  private frozen = false;

  public register(gate: CashPresentationGate): this {
    if (this.frozen || this.gates.has(gate.id)) {
      throw policyError("cash.presentationGate.registrationRejected", gate.id);
    }
    this.gates.set(gate.id, gate);
    return this;
  }

  public freeze(): this {
    this.frozen = true;
    return this;
  }

  public require(id: string): CashPresentationGate {
    const gate = this.gates.get(id);
    if (!gate) throw policyError("cash.presentationGate.missing", id);
    return gate;
  }
}

export class CashPresentationPolicyRegistry {
  private readonly policies = new Map<string, CashPresentationPolicy>();
  private frozen = false;

  public register(policy: CashPresentationPolicy): this {
    if (this.frozen || this.policies.has(policy.id)) {
      throw policyError("cash.presentationPolicy.registrationRejected", policy.id);
    }
    this.policies.set(policy.id, Object.freeze({ ...policy, requiredGates: [...policy.requiredGates] }));
    return this;
  }

  public freeze(): this {
    this.frozen = true;
    return this;
  }

  public require(id: string): CashPresentationPolicy {
    const policy = this.policies.get(id);
    if (!policy) throw policyError("cash.presentationPolicy.missing", id);
    return policy;
  }
}

export class CashPresentationAuthorizer {
  public constructor(
    private readonly gates: CashPresentationGateRegistry,
    private readonly now: () => number = Date.now,
    private readonly idFactory: () => string = defaultId,
  ) {}

  public async authorize(input: {
    readonly operationId: string;
    readonly cashSessionId: string;
    readonly policy: CashPresentationPolicy;
  }): Promise<CashPresentationAuthorization> {
    const satisfied: string[] = [];
    for (const gateId of input.policy.requiredGates) {
      const passed = await this.gates.require(gateId).evaluate(input);
      if (!passed) throw policyError("cash.presentationGate.failed", gateId);
      satisfied.push(gateId);
    }
    return Object.freeze({
      cashSessionId: input.cashSessionId,
      expiresAt: this.now() + input.policy.authorizationTtlMs,
      id: this.idFactory(),
      operationId: input.operationId,
      policyId: input.policy.id,
      policyVersion: input.policy.version,
      satisfiedGates: satisfied,
    });
  }
}

const policyError = (code: string, id: string): FrameworkError =>
  new FrameworkError({
    category: "dependency",
    code,
    message: `Cash presentation policy rejected: ${id}`,
    metadata: { id },
  });

const defaultId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `cash-auth-${Date.now()}-${Math.random()}`;
