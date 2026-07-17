import { FrameworkError } from "@tripley/web-container-errors";

import type { OperationEvidenceRecorderPort } from "./cash-contracts";

import type {
  CashRecoveryHostLeasePort,
  CashRecoveryLeaseRecord,
  CashRecoveryLeaseStorePort,
} from "./recovery-contracts";

export interface MaintenanceOperator {
  readonly id: string;
  readonly authenticated: boolean;
  readonly local: boolean;
  readonly roles: readonly string[];
}

export interface InterventionObservation {
  readonly kind: "deviceStatus" | "presentStatus" | "cashInventory";
  readonly status: "observed" | "unavailable";
  readonly safeSummary: Readonly<Record<string, string | number | boolean>>;
}

export interface InterventionResolutionRequest {
  readonly leaseId: string;
  readonly operator: MaintenanceOperator;
  readonly approverIds: readonly string[];
  readonly reasonCode: string;
  readonly action: string;
  readonly observations: readonly InterventionObservation[];
  readonly reconciledOutcome: "taken" | "retracted" | "notDispensed" | "custodyUnknown";
  readonly returnToService: boolean;
}

export interface InterventionResolutionPolicy {
  readonly id: string;
  readonly requiredRole: string;
  readonly approvalsRequired: number;
  readonly requiredObservations: readonly InterventionObservation["kind"][];
}

export class InterventionResolutionPolicyRegistry {
  private readonly policies = new Map<string, InterventionResolutionPolicy>();
  public register(policy: InterventionResolutionPolicy): this {
    if (this.policies.has(policy.id)) throw interventionError("cash.intervention.policyDuplicate");
    this.policies.set(policy.id, Object.freeze({ ...policy }));
    return this;
  }
  public require(id: string): InterventionResolutionPolicy {
    const policy = this.policies.get(id);
    if (!policy) throw interventionError("cash.intervention.policyMissing");
    return policy;
  }
}

export class CashInterventionResolver {
  public constructor(private readonly options: {
    readonly ownerInstanceId: string;
    readonly store: CashRecoveryLeaseStorePort;
    readonly commandLeases: CashRecoveryHostLeasePort;
    readonly policy: InterventionResolutionPolicy;
    readonly ttlMs: number;
    readonly evidence: OperationEvidenceRecorderPort;
    readonly resources: { releaseForegroundResources(leaseId: string): Promise<void> };
    readonly now?: () => Date;
  }) {}

  public async resolve(request: InterventionResolutionRequest): Promise<CashRecoveryLeaseRecord> {
    const record = await this.options.store.get(request.leaseId);
    if (!record || record.state !== "intervention") throw interventionError("cash.intervention.missing");
    this.validate(request);
    const nextToken = record.fencingToken + 1;
    const binding = await this.options.commandLeases.transition({
      fencingToken: record.fencingToken, fromAuthority: "recovery",
      hostEpoch: record.hostEpoch ?? "", logicalService: record.logicalService,
      nextFencingToken: nextToken, operationId: record.operationId,
      toAuthority: "maintenance", ttlMs: this.options.ttlMs,
    });
    const maintenanceBound = await this.options.store.compareAndSwap({
      expectedOwnerInstanceId: record.ownerInstanceId,
      expectedRevision: record.revision,
      id: record.id,
      patch: {
        authority: "maintenance", fencingToken: binding.fencingToken,
        hostEpoch: binding.hostEpoch,
        ownerInstanceId: this.options.ownerInstanceId,
        state: "maintenanceBound",
      },
      updatedAt: (this.options.now?.() ?? new Date()).toISOString(),
    });
    if (!maintenanceBound) throw interventionError("cash.intervention.fencingConflict");
    await this.options.evidence.append({
      cashSessionId: maintenanceBound.cashSessionId,
      certainty: "observed",
      kind: "cash.intervention.resolved",
      monotonicTime: performance.now(),
      operationId: maintenanceBound.operationId,
      phase: maintenanceBound.phase,
      safeDetails: {
        action: request.action,
        approverIds: [...request.approverIds],
        observations: request.observations.map((item) => ({
          kind: item.kind, safeSummary: item.safeSummary, status: item.status,
        })),
        operatorId: request.operator.id,
        reasonCode: request.reasonCode,
        reconciledOutcome: request.reconciledOutcome,
        returnToService: request.returnToService,
      },
      sequence: maintenanceBound.evidenceSequence + 1,
      source: "policy",
      wallTime: (this.options.now?.() ?? new Date()).toISOString(),
    });
    const evidenced = await this.options.store.compareAndSwap({
      expectedOwnerInstanceId: maintenanceBound.ownerInstanceId,
      expectedRevision: maintenanceBound.revision,
      id: maintenanceBound.id,
      patch: {
        evidenceSequence: maintenanceBound.evidenceSequence + 1,
        outcome: request.reconciledOutcome,
      },
      updatedAt: (this.options.now?.() ?? new Date()).toISOString(),
    });
    if (!evidenced) throw interventionError("cash.intervention.fencingConflict");
    if (!request.returnToService) return evidenced;
    await this.options.resources.releaseForegroundResources(evidenced.id);
    await this.options.commandLeases.release({
      fencingToken: evidenced.fencingToken, hostEpoch: evidenced.hostEpoch ?? "",
      logicalService: evidenced.logicalService, operationId: evidenced.operationId,
    });
    const closed = await this.options.store.compareAndSwap({
      expectedOwnerInstanceId: evidenced.ownerInstanceId,
      expectedRevision: evidenced.revision,
      id: evidenced.id,
      patch: { state: "closed" },
      updatedAt: (this.options.now?.() ?? new Date()).toISOString(),
    });
    if (!closed) throw interventionError("cash.intervention.fencingConflict");
    return closed;
  }

  private validate(request: InterventionResolutionRequest): void {
    const policy = this.options.policy;
    if (!request.operator.authenticated || !request.operator.local
      || !request.operator.roles.includes(policy.requiredRole)) {
      throw interventionError("cash.intervention.operatorRejected");
    }
    if (new Set(request.approverIds).size < policy.approvalsRequired) {
      throw interventionError("cash.intervention.approvalMissing");
    }
    const observed = new Set(request.observations.map((item) => item.kind));
    if (policy.requiredObservations.some((kind) => !observed.has(kind))) {
      throw interventionError("cash.intervention.evidenceIncomplete");
    }
    if (!request.reasonCode || !request.action) {
      throw interventionError("cash.intervention.reasonMissing");
    }
  }
}

const interventionError = (code: string): FrameworkError => new FrameworkError({
  category: "dependency", code, message: "Cash intervention resolution was rejected.",
});
