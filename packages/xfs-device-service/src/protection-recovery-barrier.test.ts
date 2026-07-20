import { describe, expect, it } from "vitest";

import { ProtectionRecoveryStartupBarrier } from "./protection-recovery-barrier";
import type {
  HostProtectionJournalRecord,
  HostProtectionStatus,
  ProtectionRecoveryHostPort,
  ProtectionRecoveryProjectionPort,
} from "./protection-recovery-contracts";
import {
  InMemoryProtectionRecoveryStore,
  xfsProtectionRecoveryMigrations,
} from "./protection-recovery-store";

describe("ProtectionRecoveryStartupBarrier", () => {
  it("imports and projects terminal evidence before acknowledgement", async () => {
    const fixture = createFixture();
    const result = await fixture.barrier.recover();

    expect(result.status).toBe("ready");
    expect(fixture.events).toEqual([
      "operationEvidence:journal-1",
      "auditEj:journal-1",
      "application:terminal",
      "host:ack",
    ]);
    expect(result.safeSummary).toEqual({
      acknowledgedGroups: 1,
      failedGroups: 0,
      hostAvailable: true,
      importedRecords: 1,
      interventionGroups: 0,
      recoveringGroups: 0,
    });
    expect(JSON.stringify(result.safeSummary)).not.toContain("safe protection detail");
    expect(JSON.stringify(result.safeSummary)).not.toContain("operation-1");
  });

  it("does not acknowledge until every idempotent projection succeeds", async () => {
    let failAudit = true;
    const fixture = createFixture({
      projectionFailure: () => {
        if (!failAudit) return false;
        failAudit = false;
        return true;
      },
    });

    await expect(fixture.barrier.recover()).resolves.toMatchObject({ status: "recovering" });
    expect(fixture.events).toEqual(["operationEvidence:journal-1", "auditEj:journal-1"]);

    await expect(fixture.barrier.recover()).resolves.toMatchObject({ status: "ready" });
    expect(fixture.events).toEqual([
      "operationEvidence:journal-1",
      "auditEj:journal-1",
      "auditEj:journal-1",
      "application:terminal",
      "host:ack",
    ]);
  });

  it("closes an acknowledgement crash window from same-epoch idle evidence", async () => {
    const fixture = createFixture({ throwAfterAck: true });

    await expect(fixture.barrier.recover()).resolves.toMatchObject({ status: "recovering" });
    await expect(fixture.barrier.recover()).resolves.toMatchObject({ status: "ready" });

    expect(fixture.events.filter((event) => event === "host:ack")).toHaveLength(1);
    expect(fixture.events.filter((event) => event === "application:terminal")).toHaveLength(1);
  });

  it("keeps non-terminal protection behind the recovering barrier", async () => {
    const fixture = createFixture({ custodyOutcome: "", phase: "customerAccessible" });
    const result = await fixture.barrier.recover();

    expect(result.status).toBe("recovering");
    expect(fixture.events).not.toContain("host:ack");
    expect(fixture.events).toContain("application:recovering");
  });

  it("keeps custody unknown in intervention without acknowledgement", async () => {
    const fixture = createFixture({ custodyOutcome: "custodyUnknown", phase: "custodyUnknown" });
    const result = await fixture.barrier.recover();

    expect(result.status).toBe("intervention");
    expect(fixture.events).not.toContain("host:ack");
    expect(fixture.events).toContain("application:intervention");
  });

  it("rejects a journal response containing records from another protection scope", async () => {
    const fixture = createFixture({ mixedJournalScope: true });
    const result = await fixture.barrier.recover();

    expect(result.status).toBe("intervention");
    expect(fixture.events).not.toContain("host:ack");
    expect(fixture.events).toContain("application:intervention");
  });

  it("fails closed when host epoch changes while a local case is unresolved", async () => {
    const fixture = createFixture({ custodyOutcome: "", phase: "customerAccessible" });
    await fixture.barrier.recover();
    fixture.host.hostEpoch = "epoch-2";

    const result = await fixture.barrier.recover();

    expect(result.status).toBe("intervention");
    expect(fixture.events).not.toContain("host:ack");
  });

  it("provides a durable schema with unique imports and projection checkpoints", async () => {
    let sql = "";
    await xfsProtectionRecoveryMigrations[0]?.up({
      close: async () => undefined,
      executeBatch: async (value) => {
        sql = value;
      },
      queryAll: async () => [],
      queryOne: async () => null,
      run: async () => ({}),
      transaction: async (fn) =>
        fn({
          executeBatch: async () => undefined,
          queryAll: async () => [],
          queryOne: async () => null,
          run: async () => ({}),
        }),
    });

    expect(sql).toContain("xfs_protection_recovery_case");
    expect(sql).toContain("xfs_protection_recovery_record");
    expect(sql).toContain("PRIMARY KEY(import_id, projection_id)");
  });
});

interface FixtureOptions {
  readonly custodyOutcome?: string;
  readonly phase?: string;
  readonly throwAfterAck?: boolean;
  readonly projectionFailure?: () => boolean;
  readonly mixedJournalScope?: boolean;
}

const createFixture = (options: FixtureOptions = {}) => {
  const events: string[] = [];
  const host = new FakeHost(
    status(options.phase ?? "retracted", options.custodyOutcome ?? "retracted"),
    [
      journal(options.phase ?? "retracted", options.custodyOutcome ?? "retracted"),
      ...(options.mixedJournalScope
        ? [
            {
              ...journal(options.phase ?? "retracted", options.custodyOutcome ?? "retracted"),
              id: "journal-foreign",
              operationId: "operation-foreign",
            },
          ]
        : []),
    ],
    events,
    options.throwAfterAck ?? false,
  );
  const projections: ProtectionRecoveryProjectionPort[] = ["operationEvidence", "auditEj"].map(
    (id) => ({
      id,
      project: async ({ record }) => {
        events.push(`${id}:${record.id}`);
        if (id === "auditEj" && options.projectionFailure?.()) throw new Error("projection failed");
      },
    }),
  );
  const barrier = new ProtectionRecoveryStartupBarrier({
    application: {
      reconcile: async ({ classification }) => {
        events.push(`application:${classification}`);
      },
    },
    host,
    now: () => new Date("2026-07-20T00:00:00.000Z"),
    projections,
    resourceGroups: [{ id: "cash-transport-1" }],
    store: new InMemoryProtectionRecoveryStore(),
  });
  return { barrier, events, host };
};

class FakeHost implements ProtectionRecoveryHostPort {
  public hostEpoch = "epoch-1";
  private acknowledged = false;

  public constructor(
    private readonly current: HostProtectionStatus,
    private readonly records: readonly HostProtectionJournalRecord[],
    private readonly events: string[],
    private readonly throwAfterAck: boolean,
  ) {}

  public async getHostEpoch(): Promise<string> {
    return this.hostEpoch;
  }

  public async protectionStatus(): Promise<HostProtectionStatus> {
    return this.acknowledged
      ? { ...this.current, custodyOutcome: "", operationId: "", phase: "idle", state: "idle" }
      : this.current;
  }

  public async protectionJournal(): Promise<readonly HostProtectionJournalRecord[]> {
    return this.records;
  }

  public async acknowledgeProtection(): Promise<void> {
    this.events.push("host:ack");
    this.acknowledged = true;
    if (this.throwAfterAck) throw new Error("connection lost after acknowledgement");
  }
}

const status = (phase: string, custodyOutcome: string): HostProtectionStatus => ({
  action: "cdmRetract",
  configHash: "config-hash",
  custodyOutcome,
  fencingToken: 7,
  operationId: "operation-1",
  phase,
  protectionPolicyProfileHash: "profile-hash",
  protectionPolicyProfileId: "standard",
  protectionPolicyProfileVersion: "1",
  reason: "ownerDisconnected",
  resourceGroup: "cash-transport-1",
  state: phase === "custodyUnknown" ? "intervention" : "protected",
});

const journal = (phase: string, custodyOutcome: string): HostProtectionJournalRecord => ({
  action: "cdmRetract",
  custodyOutcome,
  executionCertainty: "known",
  fencingToken: 7,
  id: "journal-1",
  logicalService: "CDM",
  module: "cdm",
  operationId: "operation-1",
  outcome: phase === "custodyUnknown" ? "intervention" : "completed",
  phase,
  protectionPolicyProfileHash: "profile-hash",
  protectionPolicyProfileId: "standard",
  protectionPolicyProfileVersion: "1",
  resourceGroup: "cash-transport-1",
  safeDetail: "safe protection detail",
});
