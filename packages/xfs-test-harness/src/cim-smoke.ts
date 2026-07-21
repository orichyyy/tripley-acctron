import { createWebSocketXfsClient } from "@tripley-kit/xfs-client";
import { createWebSocketXfsControlClient } from "@tripley-kit/xfs-control-client";
import {
  InMemoryCashAcceptanceStore,
  XfsCashAcceptanceLeaseAdapter,
  createCimDepositDevicePort,
} from "@tripley-kit/web-container-xfs-device-service";

import type { XfsHostdTestConfig } from "./config";
import { XfsTestCommandLeaseSet } from "./command-leases";

export const CANONICAL_CIM_LOGICAL_SERVICE = "CashAcceptor1";

export interface HostdCimTransactionSummary {
  readonly afterRevision: string;
  readonly beforeRevision: string;
  readonly logicalName: string;
  readonly noteCount: number;
  readonly operationId: string;
}

export const runHostdCimTransaction = async (
  config: XfsHostdTestConfig,
): Promise<HostdCimTransactionSummary> => {
  const xfs = createWebSocketXfsClient({
    ...(config.authToken ? { authToken: config.authToken } : {}),
    commandLeasing: "required",
    requiredModules: ["manager", "cim"],
    url: config.url,
  });
  const control = createWebSocketXfsControlClient({
    ...(config.authToken ? { authToken: config.authToken } : {}),
    url: config.url,
  });
  let sessionId: string | undefined;
  try {
    await Promise.all([xfs.connect(), control.connect()]);
    const logicalName = await discoverCim(control, config.cimLogicalName);
    await clearRecoveredProtection(requireLeases(xfs), config.cimResourceGroup);
    await prepareCimCashUnits(control, logicalName);
    await xfs.manager.startup({ versionsRequired: versionRange });
    const opened = await xfs.manager.open({
      appId: `${config.appId}.cim-transaction`,
      logicalName,
      serviceVersionsRequired: versionRange,
      timeoutMs: config.timeoutMs,
      traceLevel: 0,
    });
    sessionId = opened.session.id;
    await resetCim(xfs, sessionId, logicalName, config);
    await control.cim.clearStagedCashIn({ logicalName });
    const device = createCimDepositDevicePort(xfs.cim, sessionId, config.timeoutMs);
    const service = device.createService({
      entryGate: { assertCanStart: async () => undefined },
      evidence: { append: async () => undefined },
      leases: new XfsCashAcceptanceLeaseAdapter({
        commandLeases: requireLeases(xfs),
        nextFencingToken: async () => Date.now() * 1_000,
        ownerInstanceId: `${config.appId}.cim-transaction`,
        protectionPolicyProfileId: config.protectionProfileId,
        ttlMs: 30_000,
      }),
      store: new InMemoryCashAcceptanceStore(),
    });
    const operationId = `cim-transaction-${Date.now()}-${process.pid}`;
    const before = await device.captureInventory();
    const acceptance = await service.start({
      logicalService: logicalName,
      operationId,
      policy: {
        acceptTimeoutMs: config.timeoutMs,
        inputPosition: config.cimInputPosition,
        notTakenAction: "retract",
        outputPosition: config.cimOutputPosition,
        retractTimeoutMs: config.timeoutMs,
        startTimeoutMs: config.timeoutMs,
        takeTimeoutMs: config.timeoutMs,
      },
      resourceGroup: config.cimResourceGroup,
    });
    await stageCash(control, logicalName, config.cimInputPosition);
    const queuedCount = await stagedNoteCount(control, logicalName);
    if (queuedCount !== 2) {
      throw new Error(`CIM simulator staged ${queuedCount} notes; expected 2.`);
    }
    const snapshot = await acceptance.acceptBatch();
    const remainingCount = await stagedNoteCount(control, logicalName);
    if (snapshot.notes.length === 0 && remainingCount > 0) {
      throw new Error(
        `CIM cashIn returned no notes and left ${remainingCount} staged simulator notes.`,
      );
    }
    const authorization = await acceptance.authorize({
      authorize: async (candidate) => ({
        approved: true,
        operationId,
        revision: candidate.revision,
        snapshotHash: candidate.hash,
      }),
    });
    const committed = await acceptance.commit(authorization);
    if (!committed.committed) {
      throw new Error(`CIM cash-in did not complete: ${committed.reason}`);
    }
    const after = await device.captureInventory();
    return {
      afterRevision: after.revision,
      beforeRevision: before.revision,
      logicalName,
      noteCount: snapshot.notes.reduce((total, note) => total + note.count, 0),
      operationId,
    };
  } finally {
    if (sessionId) await xfs.manager.close({ sessionId }).catch(() => undefined);
    await Promise.allSettled([control.dispose(), xfs.dispose()]);
  }
};

const discoverCim = async (
  control: ReturnType<typeof createWebSocketXfsControlClient>,
  override?: string,
): Promise<string> => {
  if (override) return override;
  const { services } = await control.runtime.listLogicalServices({});
  const service = services.find(
    (candidate) => candidate.enabled && candidate.className.toUpperCase() === "CIM",
  );
  if (!service) throw new Error("The XFS simulator has no enabled CIM logical service.");
  return service.logicalName;
};

const resetCim = async (
  client: ReturnType<typeof createWebSocketXfsClient>,
  sessionId: string,
  logicalName: string,
  config: XfsHostdTestConfig,
): Promise<void> => {
  const lease = await XfsTestCommandLeaseSet.acquire(client, [logicalName], "recovery", {
    ownerInstanceId: `${config.appId}.cim-reset`,
    protectionPolicyProfileId: config.protectionProfileId,
    resourceGroup: config.cimResourceGroup,
  });
  try {
    const result = await client.cim.reset({
      itemPosition: {
        number: 0,
        outputPosition: config.cimOutputPosition,
        retractArea: {
          index: 1,
          outputPosition: config.cimOutputPosition,
          retractArea: 2,
        },
      },
      sessionId,
      timeoutMs: config.timeoutMs,
    });
    if (result.hResult !== 0) {
      throw new Error(
        `CIM reset failed with HRESULT 0x${(result.hResult >>> 0).toString(16)}.`,
      );
    }
  } finally {
    await lease.release();
  }
};

const prepareCimCashUnits = async (
  control: ReturnType<typeof createWebSocketXfsControlClient>,
  logicalName: string,
): Promise<void> => {
  const cashUnitInfo = await control.cim.getCashUnitInfo({ logicalName });
  const acceptingUnit = cashUnitInfo.cashUnits.find(
    (unit) => unit.currencyId === "CNY" && unit.values === 100,
  );
  if (!acceptingUnit) {
    throw new Error("CIM simulator has no CNY 100 accepting cash unit.");
  }
  acceptingUnit.cashUnitType = 2;
  acceptingUnit.cdmType = 0;
  acceptingUnit.noteIdsJson = "[1]";
  acceptingUnit.maximum = Math.max(acceptingUnit.maximum, acceptingUnit.count + 100);
  acceptingUnit.physical = acceptingUnit.physical.map((physical) => ({
    ...physical,
    maximum: Math.max(physical.maximum, physical.count + 100),
  }));
  await control.cim.setCashUnitInfo({ cashUnitInfo, logicalName });
};

const stageCash = async (
  control: ReturnType<typeof createWebSocketXfsControlClient>,
  logicalName: string,
  inputPosition: number,
): Promise<void> => {
  const result = await control.cim.stageCashInBunch({
    bunch: {
      items: [{ count: 2, currencyId: "CNY", value: 100 }],
      refusedItems: [],
    },
    inputPosition,
    logicalName,
  });
  if (result.hresult !== 0) {
    throw new Error(
      `CIM simulator stage cash failed with HRESULT 0x${(result.hresult >>> 0).toString(16)}.`,
    );
  }
};

const stagedNoteCount = async (
  control: ReturnType<typeof createWebSocketXfsControlClient>,
  logicalName: string,
): Promise<number> => {
  const staged = await control.cim.listStagedCashIn({ logicalName });
  return staged.batches.reduce(
    (total, batch) => total + batch.items.reduce((count, item) => count + item.count, 0),
    0,
  );
};

const requireLeases = (client: ReturnType<typeof createWebSocketXfsClient>) => {
  if (!client.commandLeases) throw new Error("Host command leasing is required.");
  return client.commandLeases;
};

const clearRecoveredProtection = async (
  leases: NonNullable<ReturnType<typeof createWebSocketXfsClient>["commandLeases"]>,
  resourceGroup: string,
): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const status = await leases.protectionStatus(resourceGroup);
    if (status.state === "idle") return;
    if (status.state === "terminal" && status.operationId) {
      await leases.acknowledgeProtection({
        hostEpoch: await leases.getHostEpoch(),
        operationId: status.operationId,
        resourceGroup,
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const status = await leases.protectionStatus(resourceGroup);
  throw new Error(
    `CIM protection resource '${resourceGroup}' is not recoverable: ${status.state}:${status.reason}.`,
  );
};

const versionRange = { high: 0x2803, low: 0x0203 } as const;
