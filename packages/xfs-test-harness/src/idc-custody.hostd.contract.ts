import { DeviceRegistry } from "@tripley-kit/web-container-device-core";
import {
  CardCustodyPolicyRegistry,
  CardCustodyService,
  XfsCardCustodyLeaseAdapter,
  XfsDeviceService,
  type CardCustodyEvidence,
  type XfsCardReaderPort,
} from "@tripley-kit/web-container-xfs-device-service";
import {
  XfsIdcDataSourceFromRaw,
  XfsEventClassFromRaw,
  createWebSocketXfsClient,
  type TripleyXfsClient,
} from "@tripley-kit/xfs-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { xfsHostdTestConfigFromEnv } from "./config";
import { XfsHostdTestHarness } from "./harness";
import { prepareIdcNoMedia } from "./idc-preconditions";
import { XfsTestCommandLeaseSet } from "./command-leases";

describe("hostd-backed IDC card custody", () => {
  const config = xfsHostdTestConfigFromEnv();
  const harness = new XfsHostdTestHarness(config);
  const devices = new DeviceRegistry();
  const evidence: CardCustodyEvidence[] = [];
  let client: TripleyXfsClient;
  let service: XfsDeviceService;
  let logicalName: string;
  let fencingSequence = 0;
  const nextFencingToken = () => {
    fencingSequence = Math.max(fencingSequence + 1, Date.now() * 1_000 + 999);
    return fencingSequence;
  };

  beforeAll(async () => {
    await harness.connect();
    const names = await harness.discoverLogicalServices();
    logicalName = names.idc;
    client = createWebSocketXfsClient({
      ...(config.authToken ? { authToken: config.authToken } : {}),
      commandLeasing: "required",
      requiredModules: ["manager", "idc"],
      url: config.url,
    });
    await client.connect();
    service = new XfsDeviceService({
      appId: config.appId,
      logicalServices: [{
        capabilities: ["card.read", "card.eject", "card.retain", "card.mediaStatus"],
        deviceId: "cardReader",
        logicalName,
        module: "idc",
      }],
      timeoutMs: config.timeoutMs,
      url: config.url,
    }, { client });
    await service.connect();
    service.registerDevices(devices);
    const leaseClient = requireLeaseClient(client);
    const protection = await leaseClient.protectionStatus("card-transport-1");
    if (protection.state !== "idle") {
      await harness.ensureNoCard(logicalName);
      await leaseClient.acknowledgeProtection({
        hostEpoch: await leaseClient.getHostEpoch(),
        operationId: protection.operationId,
        resourceGroup: "card-transport-1",
      });
    }
    const cleanupLease = await acquireIdcLease(client, logicalName, config.appId);
    try {
      await prepareIdcNoMedia(client, harness, logicalName, config.timeoutMs);
    } finally {
      await cleanupLease.release();
    }
  });

  afterAll(async () => {
    if (logicalName) await harness.takeCard(logicalName).catch(() => undefined);
    await service?.dispose().catch(() => undefined);
    await client?.dispose().catch(() => undefined);
    await harness.dispose().catch(() => undefined);
  });

  it("ejects and observes a taken card under a host fencing lease", async () => {
    const card = devices.require<XfsCardReaderPort>("cardReader");
    const operationId = `idc-custody-${Date.now()}`;
    const leaseAdapter = new XfsCardCustodyLeaseAdapter({
      commandLeases: requireLeaseClient(client),
      nextFencingToken: async () => nextFencingToken(),
      ownerInstanceId: config.appId,
      protectionPolicyProfileId: "real-smoke",
      ttlMs: 30_000,
    });
    const authority = await leaseAdapter.acquire({
      authority: "transaction",
      logicalService: logicalName,
      operationId,
      resourceGroup: "card-transport-1",
    });
    const read = card.readCard({ dataSources: 2 });
    await retry(() => harness.insertTestCard(logicalName));
    await read;
    const custody = new CardCustodyService({
      card,
      evidence: { append: async (entry) => { evidence.push(entry); } },
      leases: leaseAdapter,
      logicalService: logicalName,
      resourceGroup: "card-transport-1",
      policies: new CardCustodyPolicyRegistry().register({
        id: "hostd.return-card",
        pollIntervalMs: 25,
        takeTimeoutAction: "retain",
        takeTimeoutMs: config.timeoutMs,
        version: "1",
      }),
    });

    const outcomePromise = custody.returnCard({
      authority,
      operationId,
      policyId: "hostd.return-card",
    });
    await retry(() => harness.takeCard(logicalName));
    await expect(outcomePromise).resolves.toMatchObject({
      authorityReleased: true,
      reason: "taken",
      status: "returned",
    });
    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "authority-acquired", fencingToken: expect.any(Number) }),
      expect.objectContaining({ action: "terminal", status: "returned" }),
    ]));
  });

  it("ejects then retains a card when its transaction owner disconnects", async () => {
    const cleanupLease = await acquireIdcLease(client, logicalName, config.appId);
    try {
      await prepareIdcNoMedia(client, harness, logicalName, config.timeoutMs);
    } finally {
      await cleanupLease.release();
    }
    const owner = createWebSocketXfsClient({
      ...(config.authToken ? { authToken: config.authToken } : {}),
      commandLeasing: "required",
      requiredModules: ["manager", "idc"],
      url: config.url,
    });
    const operationId = `idc-disconnect-${Date.now()}`;
    let disconnected = false;
    try {
      await owner.connect();
      const session = await owner.manager.open({
        appId: `${config.appId}.disconnect`,
        logicalName,
        serviceVersionsRequired: { high: 0x2803, low: 0x0203 },
        timeoutMs: config.timeoutMs,
        traceLevel: 0,
      });
      await owner.manager.registerEvents({
        eventClass: XfsEventClassFromRaw(2),
        sessionId: session.session.id,
      });
      const leaseClient = requireLeaseClient(owner);
      const hostEpoch = await leaseClient.getHostEpoch();
      await leaseClient.acquire({
        authority: "transaction",
        fencingToken: nextFencingToken(),
        hostEpoch,
        logicalService: logicalName,
        operationId,
        ownerInstanceId: `${config.appId}.disconnect`,
        protectionPolicyProfileId: "real-smoke",
        resourceGroup: "card-transport-1",
        ttlMs: 30_000,
      });
      const read = owner.idc.readRawData({
        dataSources: XfsIdcDataSourceFromRaw(2),
        sessionId: session.session.id,
        timeoutMs: config.timeoutMs,
      });
      await Promise.race([
        retry(() => harness.insertTestCard(logicalName)),
        read.then(() => {
          throw new Error("IDC read ended before simulator insertion.");
        }),
      ]);
      await read;
      await owner.dispose();
      disconnected = true;

      const observer = requireLeaseClient(client);
      await waitUntil(async () =>
        (await observer.protectionStatus("card-transport-1")).phase ===
        "idc.customerAccessible"
      );
      expect(await harness.cardMediaPosition(logicalName)).not.toBe(0);
      await waitUntil(async () =>
        (await observer.protectionStatus("card-transport-1")).phase === "retained"
      );
      expect(await harness.cardMediaPosition(logicalName)).toBe(0);
      await expect(observer.protectionJournal(operationId)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: "idcEjectThenAwaitTake", outcome: "completed" }),
          expect.objectContaining({ action: "waitUntilDeadlineThenIdcRetain", outcome: "completed" }),
          expect.objectContaining({ phase: "retained" }),
        ]),
      );
      await observer.acknowledgeProtection({
        hostEpoch: await observer.getHostEpoch(),
        operationId,
        resourceGroup: "card-transport-1",
      });
    } finally {
      if (!disconnected) await owner.dispose().catch(() => undefined);
    }
  });
});

const requireLeaseClient = (client: TripleyXfsClient) => {
  if (!client.commandLeases) throw new Error("Hostd command lease service is required");
  return client.commandLeases;
};

const acquireIdcLease = (
  client: TripleyXfsClient,
  logicalName: string,
  ownerInstanceId: string,
) => XfsTestCommandLeaseSet.acquire(client, [logicalName], "transaction", {
  ownerInstanceId,
  protectionPolicyProfileId: "real-smoke",
  resourceGroup: "card-transport-1",
});

const retry = async (action: () => Promise<void>): Promise<void> => {
  const deadline = Date.now() + 5_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await action();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("Timed out waiting for IDC simulator state.", { cause: lastError });
};

const waitUntil = async (predicate: () => Promise<boolean>): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for IDC host protection state.");
};
