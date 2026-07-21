import type {
  OperationFinalizationContext,
  OperationFinalizer,
  OperationFinalizerRegistry,
} from "@tripley-kit/web-container-kiosk-runtime";

import type {
  DepositAuditPort,
  DepositHostPostingPort,
  DepositOutcome,
  DepositScopedStatePort,
  DepositTransactionPort,
} from "./contracts";

export interface DepositLocalFinalizerPorts {
  readonly transactions: DepositTransactionPort;
  readonly audit: DepositAuditPort;
  readonly scopedState: DepositScopedStatePort;
}

export const registerDepositLocalFinalizers = (
  registry: OperationFinalizerRegistry,
  ports: DepositLocalFinalizerPorts,
): OperationFinalizerRegistry => registry
  .register({
    id: "deposit.transaction.finalize",
    version: "1",
    execute: async (context) => ports.transactions.finish(requireOutcome(context)),
  })
  .register({
    id: "deposit.audit.finalize",
    version: "1",
    after: ["deposit.transaction.finalize"],
    execute: async (context) => {
      const outcome = requireOutcome(context);
      await ports.audit.append({
        data: outcome.safeSummary,
        eventId: "deposit.terminal",
        message: "Deposit reached a terminal application outcome",
        operationId: outcome.operationId,
      });
    },
  })
  .register({
    id: "deposit.scope.reset",
    version: "1",
    after: ["deposit.audit.finalize"],
    execute: async (context) => ports.scopedState.reset(
      requireOutcome(context).operationId,
      "deposit.operation.finalization",
    ),
  });

export const createDepositHostFinancialCompletionFinalizer = (
  host: DepositHostPostingPort,
): OperationFinalizer => ({
  id: "project.host.deposit-financial-completion",
  version: "1",
  after: ["deposit.scope.reset"],
  execute: async (context) => {
    const outcome = requireOutcome(context);
    if (outcome.host.protocolMode !== "authorization-then-completion") return;
    if (outcome.host.status !== "approved") return;
    if (!outcome.physical.committed || outcome.physical.commit !== "completed") return;
    if (!host.complete) throw new Error("Deposit Host Financial Completion port is not configured");
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

const requireOutcome = (context: OperationFinalizationContext): DepositOutcome => {
  const result = context.result;
  if (!result || typeof result !== "object" || !("kind" in result) || result.kind !== "deposit.outcome") {
    throw new Error(`Deposit finalization context is invalid: ${context.operationId}`);
  }
  return result as DepositOutcome;
};
