import { describe, expect, it } from "vitest";

import { CashInterventionResolver } from "./intervention";
import type { CashOperationEvidence } from "./cash-contracts";
import { InMemoryCashRecoveryLeaseStore } from "./recovery-store";
import { CashRecoverySupervisor } from "./recovery-supervisor";

describe("CashRecoverySupervisor", () => {
  it("transfers a staged session without releasing host authority", async () => {
    const fixture = await createFixture("staged");
    const receipt = await fixture.supervisor.acceptTransfer({
      evidenceSequence: 4,
      hostCommandLease: {
        fencingToken: 1, hostEpoch: "epoch-1", logicalService: "CDM1", operationId: "op-1",
      },
      lease: {
        cashSessionId: "cash-1", fencingToken: 1, id: "lease-1",
        logicalService: "CDM1", operationId: "op-1", ownerInstanceId: "runtime-1", revision: 1,
      },
      phase: "staged",
      releaseForegroundResources: async () => {},
      trigger: "timeout",
    });

    expect(receipt).toMatchObject({ fencingToken: 2, state: "recoveryBound" });
    expect(fixture.host.transitions).toHaveLength(1);
    expect(fixture.host.releases).toHaveLength(0);
  });

  it("retracts staged cash on startup and closes the durable lease", async () => {
    const fixture = await createFixture("staged");
    await bind(fixture);

    const result = await fixture.supervisor.recover();

    expect(result).toMatchObject({ recovered: 1, status: "ready", unresolved: 0 });
    await expect(fixture.store.get("lease-1")).resolves.toMatchObject({
      outcome: "retracted", state: "closed",
    });
    expect(fixture.device.retracts).toBe(1);
    expect(fixture.afterSnapshots).toEqual([
      expect.objectContaining({ boundary: "after", operationId: "op-1" }),
    ]);
  });

  it("keeps unknown custody in intervention and rejects remote resolution", async () => {
    const fixture = await createFixture("unknown");
    await bind(fixture);
    await expect(fixture.supervisor.recover()).resolves.toMatchObject({ status: "intervention" });
    const resolutionEvidence: CashOperationEvidence[] = [];
    let releasedResources = 0;
    const resolver = new CashInterventionResolver({
      commandLeases: fixture.host, ownerInstanceId: "runtime-1",
      evidence: {
        append: async (item) => { resolutionEvidence.push(item); return receipt(); },
        recordAfterSnapshot: async () => receipt(),
        recordBeforeMovement: async () => receipt(),
      },
      policy: {
        approvalsRequired: 1, id: "bank.cash", requiredObservations: ["deviceStatus"],
        requiredRole: "cash-maintenance",
      },
      store: fixture.store, ttlMs: 30_000,
      resources: { releaseForegroundResources: async () => { releasedResources += 1; } },
    });

    await expect(resolver.resolve({
      action: "cassette-reconciled", approverIds: ["supervisor-1"], leaseId: "lease-1",
      observations: [{ kind: "deviceStatus", safeSummary: {}, status: "observed" }],
      operator: { authenticated: true, id: "operator-1", local: false, roles: ["cash-maintenance"] },
      reasonCode: "cash-counted", reconciledOutcome: "retracted", returnToService: true,
    })).rejects.toMatchObject({ code: "cash.intervention.operatorRejected" });

    await expect(resolver.resolve({
      action: "cassette-reconciled", approverIds: ["supervisor-1"], leaseId: "lease-1",
      observations: [{ kind: "deviceStatus", safeSummary: { state: "ready" }, status: "observed" }],
      operator: { authenticated: true, id: "operator-1", local: true, roles: ["cash-maintenance"] },
      reasonCode: "cash-counted", reconciledOutcome: "retracted", returnToService: true,
    })).resolves.toMatchObject({ authority: "maintenance", outcome: "retracted", state: "closed" });
    expect(releasedResources).toBe(1);
    expect(resolutionEvidence).toEqual([
      expect.objectContaining({
        kind: "cash.intervention.resolved",
        safeDetails: expect.objectContaining({ operatorId: "operator-1", reasonCode: "cash-counted" }),
      }),
    ]);
  });

  it("leaves a recoverable transferPending record when host transition is uncertain", async () => {
    const fixture = await createFixture("staged");
    fixture.host.failTransition = true;

    await expect(bind(fixture)).resolves.toMatchObject({ state: "transferPending" });
    await expect(fixture.store.get("lease-1")).resolves.toMatchObject({
      pendingFencingToken: 2, state: "transferPending",
    });
  });

  it("keeps a deadline breach in intervention after successful retract", async () => {
    const fixture = await createFixture("staged", new Date(500).toISOString());
    await bind(fixture);

    await expect(fixture.supervisor.recover()).resolves.toMatchObject({
      deadlineBreaches: 1, status: "intervention",
    });
    await expect(fixture.store.get("lease-1")).resolves.toMatchObject({
      interventionReason: "cash.recovery.deadlineBreached",
      outcome: "retracted",
      state: "intervention",
    });
    const observes = fixture.device.observes;
    await fixture.supervisor.recover();
    expect(fixture.device.observes).toBe(observes);
  });

  it("does not close recovery when host lease release fails", async () => {
    const fixture = await createFixture("staged");
    await bind(fixture);
    fixture.host.failRelease = true;

    await expect(fixture.supervisor.recover()).resolves.toMatchObject({ status: "intervention" });
    await expect(fixture.store.get("lease-1")).resolves.toMatchObject({
      interventionReason: "cash.recovery.resourceReleaseFailed",
      state: "intervention",
    });
  });
});

const bind = async (fixture: Awaited<ReturnType<typeof createFixture>>) => fixture.supervisor.acceptTransfer({
  evidenceSequence: 2,
  hostCommandLease: {
    fencingToken: 1, hostEpoch: "epoch-1", logicalService: "CDM1", operationId: "op-1",
  },
  lease: {
    cashSessionId: "cash-1", fencingToken: 1, id: "lease-1",
    logicalService: "CDM1", operationId: "op-1", ownerInstanceId: "runtime-1", revision: 1,
  },
  phase: "staged",
  releaseForegroundResources: async () => {},
  trigger: "routeExit",
});

const createFixture = async (
  state: "staged" | "unknown",
  recoveryDeadlineAt = new Date(60_000).toISOString(),
) => {
  const store = new InMemoryCashRecoveryLeaseStore();
  await store.create({
    cashSessionId: "cash-1", createdAt: new Date(0).toISOString(), fencingToken: 1,
    id: "lease-1", logicalService: "CDM1", module: "cdm", operationId: "op-1",
    ownerInstanceId: "runtime-1", recoveryDeadlineAt,
  });
  const evidence: CashOperationEvidence[] = [];
  const afterSnapshots: import("./cash-contracts").CashInventorySnapshot[] = [];
  const host = new FakeHostLeases();
  const device = {
    observes: 0,
    retracts: 0,
    captureAfterSnapshot: async () => ({
      boundary: "after" as const,
      capturedAt: new Date(1_000).toISOString(),
      cashSessionId: "cash-1",
      certainty: "observed" as const,
      id: "snapshot-1",
      logicalService: "CDM1",
      operationId: "op-1",
      revision: "test.1",
      source: "device" as const,
      units: [],
    }),
    observe: async () => { device.observes += 1; return { state } as const; },
    retract: async () => { device.retracts += 1; return { state: "retracted" as const }; },
  };
  const supervisor = new CashRecoverySupervisor({
    commandLeaseTtlMs: 30_000,
    commandLeases: host,
    devices: { require: () => device },
    evidence: {
      append: async (item) => { evidence.push(item); return receipt(); },
      recordAfterSnapshot: async (snapshot) => {
        afterSnapshots.push(snapshot);
        return receipt();
      },
      recordBeforeMovement: async () => receipt(),
    },
    now: () => new Date(1_000),
    ownerInstanceId: "runtime-1",
    store,
  });
  return { afterSnapshots, device, evidence, host, store, supervisor };
};

class FakeHostLeases {
  public failTransition = false;
  public failRelease = false;
  public transitions: unknown[] = [];
  public releases: unknown[] = [];
  private lease: Record<string, unknown> | null = {
    authority: "transaction", expiresInMs: 30_000, fencingToken: 1,
    hostEpoch: "epoch-1", logicalService: "CDM1", operationId: "op-1",
  };
  public async getHostEpoch() { return "epoch-1"; }
  public async acquire(input: Record<string, unknown>) { this.lease = { ...input, expiresInMs: 30_000 }; return this.lease as never; }
  public async transition(input: Record<string, unknown>) {
    this.transitions.push(input);
    if (this.failTransition) throw new Error("transition outcome unknown");
    this.lease = {
      authority: input.toAuthority, expiresInMs: input.ttlMs,
      fencingToken: input.nextFencingToken, hostEpoch: input.hostEpoch,
      logicalService: input.logicalService, operationId: input.operationId,
    };
    return this.lease as never;
  }
  public async status() { return this.lease as never; }
  public async release(input: unknown) {
    this.releases.push(input);
    if (this.failRelease) throw new Error("release failed");
    this.lease = null;
  }
}

const receipt = () => ({ id: "receipt", persistedAt: new Date(0).toISOString() });
