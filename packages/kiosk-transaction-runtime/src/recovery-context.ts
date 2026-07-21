import type {
  OperationFinalizationContext,
  OperationFinalizationContextProjector,
  OperationFinalizationRecoveryContext,
} from "@tripley-kit/web-container-kiosk-runtime";

export type KioskOutcomeKind = "withdrawal.outcome" | "deposit.outcome";

export const createKioskOutcomeRecoveryProjector = (
  expectedKind: KioskOutcomeKind,
): OperationFinalizationContextProjector => ({
  project: (context) => projectContext(context, expectedKind),
});

const projectContext = (
  context: OperationFinalizationContext,
  expectedKind: KioskOutcomeKind,
): OperationFinalizationRecoveryContext => {
  const result = context.result;
  if (!isExpectedOutcome(result, expectedKind)) {
    throw new Error(`Finalization outcome is not ${expectedKind}: ${context.operationId}`);
  }
  return {
    ...(context.flowId ? { flowId: context.flowId } : {}),
    ...(context.metadata ? { metadata: cloneJson(context.metadata) } : {}),
    operationId: context.operationId,
    result: cloneJson(result),
  };
};

const isExpectedOutcome = (value: unknown, kind: KioskOutcomeKind): boolean =>
  typeof value === "object" && value !== null &&
  "kind" in value && value.kind === kind &&
  "safeSummary" in value && typeof value.safeSummary === "object";

const cloneJson = <T>(value: T): T => {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Finalization recovery context is not JSON serializable");
  return JSON.parse(encoded) as T;
};
