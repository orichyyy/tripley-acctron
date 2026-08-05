import type {
  CashUnitDestinationEvidence,
  CimCashUnitObservation,
} from "./cash-acceptance-contracts";

export const normalizeCimCashUnits = (
  response: unknown,
): readonly CimCashUnitObservation[] => {
  const units = array(object(response).cashUnits).map(object);
  return units.flatMap((unit) => normalizeUnit(unit));
};

export const calculateCashUnitDestinationEvidence = (
  before: readonly CimCashUnitObservation[],
  after: readonly CimCashUnitObservation[],
  committed: readonly CimCashUnitObservation[],
): readonly CashUnitDestinationEvidence[] => {
  const previous = new Map(before.map((unit) => [key(unit), unit]));
  const committedKeys = new Set(committed.map(key));
  return after
    .map((unit) => ({
      ...unit,
      depositedCount: Math.max(0, unit.count - (previous.get(key(unit))?.count ?? unit.count)),
    }))
    .filter((unit) => unit.depositedCount > 0 || committedKeys.has(key(unit)));
};

const normalizeUnit = (unit: Record<string, unknown>): readonly CimCashUnitObservation[] => {
  const physical = array(unit.physical).map(object);
  if (physical.length === 0) return [observation(unit, {})];
  return physical.map((item) => observation(unit, item));
};

const observation = (
  logical: Record<string, unknown>,
  physical: Record<string, unknown>,
): CimCashUnitObservation => ({
  cashInCount: finite(physical.cashInCount ?? logical.cashInCount),
  count: finite(physical.count ?? logical.count),
  currency: String(logical.currencyId ?? "").trim(),
  denominationMinorUnits: finite(logical.values),
  logicalUnit: finite(logical.number),
  physicalPosition: String(physical.physicalPositionName ?? logical.name ?? ""),
  physicalUnitId: String(physical.unitId ?? logical.unitId ?? ""),
  rejectCount: finite(physical.rejectCount ?? logical.rejectCount),
  retractedCount: finite(physical.retractedCount ?? logical.retractedCount),
  status: finite(physical.status ?? logical.status),
});

const key = (unit: CimCashUnitObservation): string =>
  `${unit.logicalUnit}:${unit.physicalPosition}:${unit.physicalUnitId}`;

const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : {};

const array = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];

const finite = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
