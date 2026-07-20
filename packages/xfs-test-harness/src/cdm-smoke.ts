import {
  createWebSocketXfsClient,
  type XfsCdmCashUnitInfo,
} from "@tripley-kit/xfs-client";
import {
  createWebSocketXfsControlClient,
  type CdmCashUnitProfile,
  type CdmControlClient,
} from "@tripley-kit/xfs-control-client";

export const CANONICAL_CDM_LOGICAL_SERVICE = "CashDispenser1";
const DEFAULT_CDM_PROFILE = "tripley-acctron-contract-cny";

export interface HostdCdmSmokeOptions {
  readonly url?: string;
  readonly logicalName?: string;
  readonly profileName?: string;
}

export interface HostdCdmSmokeSummary {
  readonly logicalName: string;
  readonly profileName: string;
  readonly cashUnitCount: number;
  readonly hostEpoch: string;
}

/**
 * Test-only hostd/CDM bootstrap. Simulator mutation deliberately lives in the
 * harness package so xfs-device-service cannot acquire an xfs-control runtime
 * dependency.
 */
export async function prepareHostdCdmSimulator(
  options: HostdCdmSmokeOptions = {},
): Promise<HostdCdmSmokeSummary> {
  const url = options.url ?? "ws://127.0.0.1:39010";
  const xfs = createWebSocketXfsClient({
    url,
    requiredModules: ["manager", "cdm"],
    commandLeasing: "required",
  });
  const control = createWebSocketXfsControlClient({ url });
  let sessionId: string | undefined;
  let lease: Awaited<ReturnType<NonNullable<typeof xfs.commandLeases>["acquire"]>> | undefined;

  try {
    await Promise.all([xfs.connect(), control.connect()]);
    const logicalName = options.logicalName ?? await discoverCdmLogicalService(control);
    const profileName = await applyCashUnitProfile(
      control.cdm,
      logicalName,
      options.profileName,
    );
    await xfs.manager.startup({ versionsRequired: xfsVersionRange });
    const opened = await xfs.manager.open({
      appId: "tripley.xfs-test-harness",
      logicalName,
      serviceVersionsRequired: xfsVersionRange,
      timeoutMs: 5_000,
      traceLevel: 0,
    });
    sessionId = opened.session.id;
    const hostEpoch = await xfs.commandLeases!.getHostEpoch();
    const operationId = `xfs-test-harness:${process.pid}:${Date.now()}`;
    const fencingToken = Date.now();
    lease = await xfs.commandLeases!.acquire({
      hostEpoch,
      logicalService: logicalName,
      operationId,
      fencingToken,
      authority: "transaction",
      ttlMs: 5_000,
    });
    const cashUnitInfo = await xfs.cdm.getCashUnitInfo({
      sessionId,
      timeoutMs: 5_000,
    });
    lease = await xfs.commandLeases!.transition({
      fencingToken: lease.fencingToken,
      fromAuthority: "transaction",
      hostEpoch: lease.hostEpoch,
      logicalService: lease.logicalService,
      nextFencingToken: lease.fencingToken + 1,
      operationId: lease.operationId,
      toAuthority: "recovery",
      ttlMs: 60_000,
    });

    return summarize(logicalName, profileName, cashUnitInfo, lease.hostEpoch);
  } finally {
    if (lease) {
      await xfs.commandLeases?.release({
        hostEpoch: lease.hostEpoch,
        logicalService: lease.logicalService,
        operationId: lease.operationId,
        fencingToken: lease.fencingToken,
      }).catch(() => undefined);
    }
    if (sessionId) {
      await xfs.manager.close({ sessionId }).catch(() => undefined);
    }
    await Promise.allSettled([control.dispose(), xfs.dispose()]);
  }
}

async function discoverCdmLogicalService(
  control: ReturnType<typeof createWebSocketXfsControlClient>,
): Promise<string> {
  const { services } = await control.runtime.listLogicalServices({});
  const service = services.find((candidate) =>
    candidate.enabled && candidate.className.toUpperCase() === "CDM");
  if (!service) {
    throw new Error("The XFS simulator has no enabled CDM logical service.");
  }
  return service.logicalName;
}

export async function simulateCdmItemsTaken(
  options: Pick<HostdCdmSmokeOptions, "url" | "logicalName"> = {},
  position = 2,
): Promise<void> {
  const control = createWebSocketXfsControlClient({
    url: options.url ?? "ws://127.0.0.1:39010",
  });
  try {
    await control.connect();
    const result = await control.cdm.takeItemsByLogicalService({
      logicalName: options.logicalName ?? CANONICAL_CDM_LOGICAL_SERVICE,
      position,
    });
    if (result.hresult !== 0) {
      throw new Error(`CDM simulator take-items failed with HRESULT ${result.hresult}.`);
    }
  } finally {
    await control.dispose();
  }
}

async function applyCashUnitProfile(
  cdm: CdmControlClient,
  logicalName: string,
  requestedProfile?: string,
): Promise<string> {
  const profiles = await cdm.listCashUnitProfiles({});
  const profileName = requestedProfile ?? DEFAULT_CDM_PROFILE;
  const profileExists = profiles.profiles.some((profile) => profile.name === profileName);
  if (!requestedProfile || !profileExists) {
    await cdm.upsertCashUnitProfile({ profile: defaultCashUnitProfile(profileName) });
  }
  await cdm.applyCashUnitProfile({ logicalName, profileName });
  return profileName;
}

function defaultCashUnitProfile(name: string): CdmCashUnitProfile {
  const initialCount = 1_000;
  const unitId = "CNY01";
  return {
    cashUnitInfo: {
      tellerId: 0,
      cashUnits: [{
        appLock: false,
        cashUnitType: 3,
        count: initialCount,
        currencyId: "CNY",
        dispensedCount: 0,
        initialCount,
        maximum: initialCount,
        minimum: 10,
        name: "CNY 100",
        number: 1,
        physical: [{
          count: initialCount,
          dispensedCount: 0,
          hardwareSensor: true,
          initialCount,
          maximum: initialCount,
          physicalPositionName: "Cassette 1",
          presentedCount: 0,
          rejectCount: 0,
          retractedCount: 0,
          status: 0,
          unitId,
        }],
        presentedCount: 0,
        rejectCount: 0,
        retractedCount: 0,
        serialNumberEnabled: false,
        status: 0,
        unitId,
        values: 100,
      }, {
        appLock: false,
        cashUnitType: 6,
        count: 0,
        currencyId: "   ",
        dispensedCount: 0,
        initialCount: 0,
        maximum: 100,
        minimum: 0,
        name: "Retract 1",
        number: 2,
        physical: [{
          count: 0,
          dispensedCount: 0,
          hardwareSensor: true,
          initialCount: 0,
          maximum: 100,
          physicalPositionName: "Retract Cassette 1",
          presentedCount: 0,
          rejectCount: 0,
          retractedCount: 0,
          status: 0,
          unitId: "RTR01",
        }],
        presentedCount: 0,
        rejectCount: 0,
        retractedCount: 0,
        serialNumberEnabled: false,
        status: 0,
        unitId: "RTR01",
        values: 0,
      }],
    },
    description: "Tripley Acctron deterministic CDM contract profile",
    mediaKind: "cash",
    name,
  };
}

function summarize(
  logicalName: string,
  profileName: string,
  info: XfsCdmCashUnitInfo,
  hostEpoch: string,
): HostdCdmSmokeSummary {
  return {
    logicalName,
    profileName,
    cashUnitCount: info.cashUnits?.length ?? 0,
    hostEpoch,
  };
}

const xfsVersionRange = {
  low: 0x0203,
  high: 0x2803,
} as const;
