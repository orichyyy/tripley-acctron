import type {
  DepositExecutionResult,
  DepositOrchestratorOptions,
  DepositRequest,
} from "./contracts";
import { buildDepositOutcome, initialDepositState } from "./outcome";
import { runDepositWorkflow } from "./workflow";

export class DepositOrchestrator {
  public constructor(private readonly options: DepositOrchestratorOptions) {}

  public async execute(request: DepositRequest): Promise<DepositExecutionResult> {
    const policy = this.options.policies.require(request.policyId);
    assertRequest(request);
    const state = initialDepositState(policy);
    const admission = await this.options.recoveryBarrier?.recover();
    if (admission && admission.status !== "ready") {
      return {
        outcome: buildDepositOutcome(
          request,
          policy,
          state,
          "intervention",
          "recovery-barrier-blocked",
        ),
      };
    }

    await this.options.transactions.start(request, policy);
    await this.options.audit.append({
      data: { logicalService: policy.logicalService, policyId: policy.id },
      eventId: "deposit.started",
      message: "Deposit orchestration started",
      operationId: request.operationId,
    });

    const outcome = await runDepositWorkflow(this.options, request, policy, state);
    const finalization = await this.options.finalization.run({
      metadata: { policyId: policy.id, policyVersion: policy.version },
      operationId: request.operationId,
      result: outcome,
    });
    return { finalization, outcome };
  }
}

const assertRequest = (request: DepositRequest): void => {
  if (!request.operationId.trim()) throw new Error("Deposit operation identity is required");
};
