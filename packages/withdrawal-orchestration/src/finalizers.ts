import type {
  OperationFinalizationContext,
  OperationFinalizer,
  OperationFinalizerRegistry,
} from "@tripley-kit/web-container-kiosk-runtime";

import type {
  WithdrawalAuditPort,
  WithdrawalHostPostingPort,
  WithdrawalOutcome,
  WithdrawalScopedStatePort,
  WithdrawalTransactionPort,
} from "./contracts";

export interface WithdrawalLocalFinalizerPorts {
  readonly transactions: WithdrawalTransactionPort;
  readonly audit: WithdrawalAuditPort;
  readonly scopedState: WithdrawalScopedStatePort;
}

export const registerWithdrawalLocalFinalizers = (
  registry: OperationFinalizerRegistry,
  ports: WithdrawalLocalFinalizerPorts,
): OperationFinalizerRegistry => registry
  .register(createTransactionFinalizer(ports.transactions))
  .register(createAuditFinalizer(ports.audit))
  .register(createScopedStateFinalizer(ports.scopedState));

export const createHostFinancialCompletionFinalizer = (
  host: WithdrawalHostPostingPort,
): OperationFinalizer => ({
  id: "project.host.financial-completion",
  version: "1",
  after: ["withdrawal.scope.reset"],
  execute: async (context) => {
    const outcome = requireOutcome(context);
    if (outcome.host.protocolMode !== "authorization-then-completion") return;
    if (outcome.host.status !== "approved") return;
    if (!host.complete) throw new Error("Host Financial Completion port is not configured");
    await host.complete({
      operationId: outcome.operationId,
      ...(outcome.host.authorizationReference
        ? { authorizationReference: outcome.host.authorizationReference }
        : {}),
      outcome,
      protocol: {
        id: outcome.host.protocolId,
        mode: outcome.host.protocolMode,
        version: outcome.host.protocolVersion,
      },
    });
  },
});

const createTransactionFinalizer = (transactions: WithdrawalTransactionPort): OperationFinalizer => ({
  id: "withdrawal.transaction.finalize",
  version: "1",
  execute: async (context) => transactions.finish(requireOutcome(context)),
});

const createAuditFinalizer = (audit: WithdrawalAuditPort): OperationFinalizer => ({
  id: "withdrawal.audit.finalize",
  version: "1",
  after: ["withdrawal.transaction.finalize"],
  execute: async (context) => {
    const outcome = requireOutcome(context);
    await audit.append({
      data: outcome.safeSummary,
      eventId: "withdrawal.terminal",
      message: "Withdrawal reached a terminal application outcome",
      operationId: outcome.operationId,
    });
  },
});

const createScopedStateFinalizer = (scopedState: WithdrawalScopedStatePort): OperationFinalizer => ({
  id: "withdrawal.scope.reset",
  version: "1",
  after: ["withdrawal.audit.finalize"],
  execute: async (context) => scopedState.reset(
    requireOutcome(context).operationId,
    "withdrawal.operation.finalization",
  ),
});

const requireOutcome = (context: OperationFinalizationContext): WithdrawalOutcome => {
  const result = context.result;
  if (!result || typeof result !== "object" || !("kind" in result) || result.kind !== "withdrawal.outcome") {
    throw new Error(`Withdrawal finalization context is invalid: ${context.operationId}`);
  }
  return result as WithdrawalOutcome;
};
