import { createWebSocketXfsClient } from "@tripley-kit/xfs-client";
import {
  type CdmCashUnitProfile,
  createWebSocketXfsControlClient,
} from "@tripley-kit/xfs-control-client";
import {
  InMemoryProtectionRecoveryStore,
  ProtectionRecoveryStartupBarrier,
  XfsProtectionRecoveryHostAdapter,
} from "@tripley/web-container-xfs-device-service";
import { describe, expect, it } from "vitest";

const confirmation = "I_UNDERSTAND_SIMULATOR_ONLY";
const describeReal =
  process.env.XFS_REAL_PROTECTION_SMOKE === confirmation ? describe : describe.skip;
const versionRange = { high: 0x2803, low: 0x0203 } as const;
const settings = {
  logicalService: process.env.TRIPLEY_XFS_CDM_LOGICAL_NAME ?? "CDM",
  profileId: process.env.TRIPLEY_XFS_PROTECTION_PROFILE ?? "real-smoke",
  resourceGroup: process.env.TRIPLEY_XFS_RESOURCE_GROUP ?? "cash-transport-1",
  url:
    process.env.TRIPLEY_XFS_HOSTD_URL ??
    process.env.TRIPLEY_NATIVE_HOSTD_URL ??
    "ws://127.0.0.1:39010",
};

describeReal("application protection recovery against hostd", () => {
  it("imports terminal CDM protection, acknowledges it, and reuses the resource group", async () => {
    const control = createWebSocketXfsControlClient({ url: settings.url });
    const observer = createClient(["manager"]);
    const application = createClient(["manager", "cdm"]);
    const projected: string[] = [];
    const reconciled: string[] = [];
    let operationId = "";

    try {
      await Promise.all([control.connect(), observer.connect()]);
      const denominationInput = await prepareCashUnits(control);
      const leases = requireLeases(observer);
      const hostEpoch = await leases.getHostEpoch();
      const initial = await leases.protectionStatus(settings.resourceGroup);
      expect(initial.state, "Protection resource group must be idle before smoke.").toBe("idle");

      await application.connect();
      await application.manager.startup({ versionsRequired: versionRange });
      const opened = await application.manager.open({
        appId: "tripley.acctron.protection-recovery-smoke",
        logicalName: settings.logicalService,
        serviceVersionsRequired: versionRange,
        timeoutMs: 5_000,
        traceLevel: 0,
      });
      operationId = `acctron-protection-recovery-${Date.now()}-${process.pid}`;
      const lease = await requireLeases(application).acquire({
        authority: "transaction",
        fencingToken: Math.max(Date.now() * 1_000, initial.fencingToken + 1),
        hostEpoch,
        logicalService: settings.logicalService,
        operationId,
        ownerInstanceId: `acctron-smoke-${process.pid}`,
        protectionPolicyProfileId: settings.profileId,
        resourceGroup: settings.resourceGroup,
        ttlMs: 30_000,
      });
      expect(lease.protectionPolicyProfileId).toBe(settings.profileId);

      const denomination = await application.cdm.denominate({
        denomination: denominationInput,
        mixNumber: 1,
        sessionId: opened.session.id,
        tellerId: 0,
        timeoutMs: 10_000,
      });
      expect(denomination.native.hResult).toBe(0);
      expect(denomination.denomination).toBeDefined();
      const dispensed = await application.cdm.dispense({
        denomination: denomination.denomination!,
        mixNumber: 1,
        position: 2,
        present: false,
        sessionId: opened.session.id,
        tellerId: 0,
        timeoutMs: 15_000,
      });
      expect(dispensed.native.hResult).toBe(0);
      await waitForPhase(observer, "cdm.cashHeld");

      await application.dispose();
      const terminal = await waitForTerminal(observer, operationId);
      expect(terminal.custodyOutcome).toBe("retracted");

      const barrier = new ProtectionRecoveryStartupBarrier({
        application: {
          reconcile: async ({ classification, idempotencyKey }) => {
            reconciled.push(`${classification}:${idempotencyKey}`);
          },
        },
        host: new XfsProtectionRecoveryHostAdapter(leases),
        projections: [
          {
            id: "operationEvidence",
            project: async ({ record }) => {
              projected.push(`evidence:${record.action}`);
            },
          },
          {
            id: "auditEj",
            project: async ({ record }) => {
              projected.push(`ej:${record.action}`);
            },
          },
        ],
        resourceGroups: [{ id: settings.resourceGroup }],
        store: new InMemoryProtectionRecoveryStore(),
      });
      const recovered = await barrier.recover();
      expect(recovered.status).toBe("ready");
      expect(projected.some((item) => item.includes("custodyTerminal"))).toBe(true);
      expect(reconciled).toHaveLength(1);
      expect((await leases.protectionStatus(settings.resourceGroup)).state).toBe("idle");

      await proveResourceGroupReuse(observer, hostEpoch, initial.fencingToken);
    } finally {
      await Promise.allSettled([application.dispose(), observer.dispose(), control.dispose()]);
    }
  });
});

const createClient = (requiredModules: readonly ("manager" | "cdm")[]) =>
  createWebSocketXfsClient({
    commandLeasing: "required",
    requiredModules,
    url: settings.url,
  });

const requireLeases = (client: ReturnType<typeof createClient>) => {
  if (!client.commandLeases) throw new Error("Host command leasing is unavailable.");
  return client.commandLeases;
};

const prepareCashUnits = async (control: ReturnType<typeof createWebSocketXfsControlClient>) => {
  const profiles = await control.cdm.listCashUnitProfiles({});
  const source =
    profiles.profiles.find((profile) => profile.name === "tripley-acctron-contract-cny") ??
    profiles.profiles[0];
  if (!source) throw new Error("XFS Simulator has no CDM cash-unit profile.");
  const profile: CdmCashUnitProfile = structuredClone(source);
  profile.name = "tripley-acctron-protection-recovery";
  profile.description = "Application protection recovery smoke profile";
  const unit = profile.cashUnitInfo.cashUnits.find(
    (candidate) => candidate.count > 0 && candidate.cashUnitType !== 6,
  );
  if (!unit) throw new Error("XFS Simulator profile has no dispensable cash unit.");
  unit.cashUnitType = 3;
  ensureRetractCashUnit(profile, unit);
  await control.cdm.upsertCashUnitProfile({ profile });
  await control.cdm.applyCashUnitProfile({
    logicalName: settings.logicalService,
    profileName: profile.name,
  });
  return {
    amount: unit.values,
    cashBox: 0,
    currencyId: unit.currencyId,
    values: new Uint8Array(),
  };
};

const ensureRetractCashUnit = (
  profile: CdmCashUnitProfile,
  source: CdmCashUnitProfile["cashUnitInfo"]["cashUnits"][number],
): void => {
  if (profile.cashUnitInfo.cashUnits.some((unit) => unit.cashUnitType === 6)) return;
  const retract = structuredClone(source);
  retract.number = Math.max(...profile.cashUnitInfo.cashUnits.map((unit) => unit.number), 0) + 1;
  Object.assign(retract, {
    cashUnitType: 6,
    count: 0,
    currencyId: "   ",
    dispensedCount: 0,
    initialCount: 0,
    maximum: 100,
    minimum: 0,
    name: "Retract 1",
    presentedCount: 0,
    rejectCount: 0,
    retractedCount: 0,
    unitId: "RTR01",
    values: 0,
  });
  retract.physical = retract.physical.map((physical) => ({
    ...physical,
    count: 0,
    dispensedCount: 0,
    initialCount: 0,
    maximum: 100,
    physicalPositionName: "Retract Cassette 1",
    presentedCount: 0,
    rejectCount: 0,
    retractedCount: 0,
    unitId: "RTR01",
  }));
  profile.cashUnitInfo.cashUnits.push(retract);
};

const waitForPhase = async (
  client: ReturnType<typeof createClient>,
  phase: string,
): Promise<void> => {
  await waitUntil(
    async () =>
      (await requireLeases(client).protectionStatus(settings.resourceGroup)).phase === phase,
  );
};

const waitForTerminal = async (client: ReturnType<typeof createClient>, operationId: string) => {
  let terminal:
    | Awaited<ReturnType<ReturnType<typeof requireLeases>["protectionStatus"]>>
    | undefined;
  await waitUntil(async () => {
    const status = await requireLeases(client).protectionStatus(settings.resourceGroup);
    if (status.state === "intervention") {
      throw new Error(`Host protection entered intervention: ${status.reason}`);
    }
    if (status.state === "terminal" && status.operationId === operationId) terminal = status;
    return terminal !== undefined;
  });
  return terminal!;
};

const proveResourceGroupReuse = async (
  observer: ReturnType<typeof createClient>,
  hostEpoch: string,
  previousToken: number,
): Promise<void> => {
  const leases = requireLeases(observer);
  const operationId = `acctron-protection-reuse-${Date.now()}-${process.pid}`;
  const lease = await leases.acquire({
    authority: "transaction",
    fencingToken: Math.max(Date.now() * 1_000, previousToken + 2),
    hostEpoch,
    logicalService: settings.logicalService,
    operationId,
    ownerInstanceId: `acctron-reuse-${process.pid}`,
    protectionPolicyProfileId: settings.profileId,
    resourceGroup: settings.resourceGroup,
    ttlMs: 5_000,
  });
  await leases.release({
    fencingToken: lease.fencingToken,
    hostEpoch: lease.hostEpoch,
    logicalService: lease.logicalService,
    operationId: lease.operationId,
  });
};

const waitUntil = async (predicate: () => Promise<boolean>): Promise<void> => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for host protection state.");
};
