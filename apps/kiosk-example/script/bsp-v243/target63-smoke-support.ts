import { DeviceLockManager } from "@tripley-kit/web-container-device-core";
import type {
  CashDeliveryDependencies,
  CashInventorySnapshot,
  CashOperationEvidence,
} from "@tripley-kit/web-container-xfs-device-service";

export interface Target63CashEvidence {
  readonly events: CashOperationEvidence[];
  readonly snapshots: CashInventorySnapshot[];
  readonly ejProjections: Readonly<Record<string, unknown>>[];
}

export function createTarget63CashEvidence(): {
  readonly dependencies: CashDeliveryDependencies;
  readonly evidence: Target63CashEvidence;
} {
  const events: CashOperationEvidence[] = [];
  const snapshots: CashInventorySnapshot[] = [];
  const ejProjections: Readonly<Record<string, unknown>>[] = [];
  let sequence = Date.now() * 1_000;
  const receipt = () => ({
    id: `target63-evidence-${++sequence}`,
    persistedAt: new Date().toISOString(),
  });
  return {
    dependencies: {
      deviceLocks: new DeviceLockManager(),
      emergencySpool: {
        append: async (event) => {
          events.push(event);
        },
      },
      evidence: {
        append: async (event) => {
          events.push(event);
          return receipt();
        },
        recordAfterSnapshot: async (snapshot) => {
          snapshots.push(snapshot);
          return receipt();
        },
        recordBeforeMovement: async (input) => {
          events.push(input.evidence);
          snapshots.push(input.snapshot);
          ejProjections.push(input.ejProjection);
          return receipt();
        },
      },
      idFactory: () => `target63-cash-${++sequence}`,
      recoveryLeases: {
        acquire: async (input) => ({
          ...input,
          fencingToken: ++sequence,
          id: `target63-recovery-${sequence}`,
        }),
        close: async () => undefined,
        hasUnresolved: async () => false,
        update: async () => undefined,
      },
    },
    evidence: { ejProjections, events, snapshots },
  };
}
