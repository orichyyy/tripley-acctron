import type {
  CashDeliveryDependencies,
  CashInventorySnapshot,
} from "./cash-contracts";
import type {
  XfsCdmClientLike,
  XfsCdmOperationalPolicy,
  XfsSessionLike,
} from "./types";
import { assertXfsOk } from "./utils";

interface CashInventorySnapshotOptions {
  readonly client: XfsCdmClientLike;
  readonly dependencies: Pick<CashDeliveryDependencies, "now">;
  readonly logicalName: string;
  readonly policy: Pick<XfsCdmOperationalPolicy, "configurationRevision">;
  readonly session: XfsSessionLike;
  readonly timeoutMs: number;
}

export const captureCdmInventorySnapshot = async (
  options: CashInventorySnapshotOptions,
  operationId: string,
  cashSessionId: string,
  boundary: CashInventorySnapshot["boundary"],
  id: string,
): Promise<CashInventorySnapshot> => {
  const result = await readWithRetry(
    () =>
      options.client.getCashUnitInfo({
        sessionId: options.session.id,
        timeoutMs: options.timeoutMs,
      }),
    2,
  );
  assertXfsOk(result, "cdm.getCashUnitInfo", {
    logicalName: options.logicalName,
  });
  const units = (result.cashUnits ?? []).map((unit) => ({
    count: unit.count,
    currency: unit.currencyId,
    denominationMinorUnits: unit.values,
    dispensedCount: unit.dispensedCount,
    logicalSlot: unit.number,
    physicalCassetteId: unit.unitId || undefined,
    physicalPosition: unit.physical[0]?.physicalPositionName,
    presentedCount: unit.presentedCount,
    rejectCount: unit.rejectCount,
    retractedCount: unit.retractedCount,
    status: unit.status,
    type: unit.cashUnitType,
  }));
  return Object.freeze({
    boundary,
    capturedAt: (options.dependencies.now?.() ?? new Date()).toISOString(),
    cashSessionId,
    certainty: "observed",
    id,
    logicalService: options.logicalName,
    operationId,
    revision: revisionOf(options.policy.configurationRevision, units),
    source: "device",
    units,
  });
};

const revisionOf = (
  configurationRevision: string,
  units: readonly unknown[],
): string => {
  const identities = units.map((value) => {
    const unit = value as Record<string, unknown>;
    return [
      unit.logicalSlot,
      unit.physicalCassetteId,
      unit.physicalPosition,
      unit.type,
      unit.currency,
      unit.denominationMinorUnits,
    ];
  });
  const input = JSON.stringify([configurationRevision, identities]);
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${configurationRevision}:${(hash >>> 0).toString(16)}`;
};

export const readWithRetry = async <T>(
  operation: () => Promise<T>,
  attempts: number,
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};
