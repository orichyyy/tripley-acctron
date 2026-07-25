import {
  DeviceLockManager,
  type DeviceRegistry,
} from "@tripley-kit/web-container-device-core";
import {
  CardCustodyPolicyRegistry,
  CardCustodyService,
  type CashDeliveryDependencies,
  type XfsCardReaderPort,
} from "@tripley-kit/web-container-xfs-device-service";

export interface Target62CardCustodyFixture {
  readonly awaitingTake: Promise<void>;
  readonly port: CardCustodyService;
}

export function createTarget62CardCustody(
  card: XfsCardReaderPort,
  logicalService: string,
): Target62CardCustodyFixture {
  let fencingToken = Date.now() * 1_000;
  let notifyAwaitingTake: () => void = () => undefined;
  const awaitingTake = new Promise<void>((resolve) => {
    notifyAwaitingTake = resolve;
  });
  const custodyCard = new Proxy(card, {
    get(target, property, receiver) {
      if (property === "waitForTaken") {
        return (
          ...args: Parameters<XfsCardReaderPort["waitForTaken"]>
        ) => {
          const result = target.waitForTaken(...args);
          notifyAwaitingTake();
          return result;
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function"
        ? value.bind(target)
        : value;
    },
  });
  const port = new CardCustodyService({
    card: custodyCard,
    evidence: { append: async () => undefined },
    leases: {
      acquire: async () => ({
        fencingToken: ++fencingToken,
        hostEpoch: "target62-simulator",
        release: async () => undefined,
      }),
    },
    logicalService,
    policies: new CardCustodyPolicyRegistry().register({
      id: "card.standard",
      interruptActions: {
        "device-loss": "intervention",
        "node-exit": "retain",
        "operation-timeout": "retain",
        "user-cancelled": "retain",
      },
      pollIntervalMs: 50,
      takeTimeoutAction: "retain",
      takeTimeoutMs: 20_000,
      version: "1",
    }),
  });
  return { awaitingTake, port };
}

export function createTarget62CashDependencies(): CashDeliveryDependencies {
  let id = 0;
  let fencingSequence = Date.now() * 1_000 + 999;
  const receipt = () => ({
    id: `target62-evidence-${++id}`,
    persistedAt: new Date().toISOString(),
  });
  const nextFencingToken = () => {
    fencingSequence = Math.max(
      fencingSequence + 1,
      Date.now() * 1_000 + 999,
    );
    return fencingSequence;
  };
  return {
    deviceLocks: new DeviceLockManager(),
    emergencySpool: { append: async () => undefined },
    evidence: {
      append: async () => receipt(),
      recordAfterSnapshot: async () => receipt(),
      recordBeforeMovement: async () => receipt(),
    },
    idFactory: () => `target62-cash-${++id}`,
    recoveryLeases: {
      acquire: async (input) => ({
        ...input,
        fencingToken: nextFencingToken(),
        id: `target62-recovery-${id}`,
      }),
      close: async () => undefined,
      hasUnresolved: async () => false,
      update: async () => undefined,
    },
  };
}

export function target62InputContext(devices: DeviceRegistry) {
  return {
    deviceLocks: new DeviceLockManager(),
    devices,
    flowId: "target62-withdrawal",
    flowVersion: "2.43",
    instanceId: "target62-simulator",
    nodeId: "target62-input",
  };
}

export function target62EnvironmentNumber(
  name: string,
  fallback: number,
): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0 || value > 99_999_999) {
    throw new Error(`Environment value is not a valid positive integer: ${name}`);
  }
  return value;
}

export function target62EnvironmentNonNegativeNumber(
  name: string,
  fallback: number,
): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 0 || value > 99_999_999) {
    throw new Error(`Environment value is not a valid non-negative integer: ${name}`);
  }
  return value;
}

export async function retryTarget62SimulatorAction(
  action: () => Promise<void>,
  operation: string,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  let lastError: unknown;
  while (!signal?.aborted && Date.now() < deadline) {
    try {
      await action();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Timed out waiting for simulator action: ${operation}`, {
    cause: lastError,
  });
}

export function safeTarget62Error(
  error: unknown,
): Readonly<Record<string, unknown>> {
  if (!(error instanceof Error)) return { kind: typeof error };
  const record = error as Error & {
    readonly category?: unknown;
    readonly code?: unknown;
  };
  return {
    ...(typeof record.category === "string"
      ? { category: record.category }
      : {}),
    ...(typeof record.code === "string" ? { code: record.code } : {}),
    message: error.message,
    name: error.name,
  };
}
