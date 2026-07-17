import { DeviceLockManager } from "@tripley/web-container-device-core";
import { describe, expect, it } from "vitest";

import type {
  CashDeliveryDependencies,
  CashOperationEvidence,
} from "./cash-contracts";
import { XfsCashDeliveryPort } from "./cash-delivery";
import {
  CashPresentationAuthorizer,
  CashPresentationGateRegistry,
  type CashPresentationPolicy,
} from "./cash-policy";

describe("XfsCashDeliveryPort", () => {
  it("rejects floating-point amounts before denomination or movement", async () => {
    const fixture = createFixture();
    await expect(fixture.port.start(request(12.5))).rejects.toThrow(/integer minor units/);
    expect(fixture.calls.denominate).toBe(0);
    expect(fixture.calls.dispense).toBe(0);
  });

  it("fails closed when the before snapshot cannot be persisted", async () => {
    const fixture = createFixture({ failBefore: true });
    await expect(fixture.port.start(request(1_000))).rejects.toThrow("before persistence failed");
    expect(fixture.calls.denominate).toBe(0);
    expect(fixture.calls.dispense).toBe(0);
    expect(fixture.calls.releaseLease).toBe(1);
  });

  it("stages cash and aborts by retracting without presenting", async () => {
    const fixture = createFixture();
    const started = await fixture.port.start(request(1_000));
    await started.session.dispense(started.plan);
    const result = await started.session.abort("timeout");

    expect(result.outcome).toBe("retracted");
    expect(fixture.calls.present).toBe(0);
    expect(fixture.calls.retract).toBe(1);
    expect(fixture.evidence.some((item) => item.trigger === "timeout")).toBe(true);
  });

  it("accepts a project gate authorization and confirms customer custody", async () => {
    const fixture = createFixture();
    const started = await fixture.port.start(request(1_000));
    await started.session.dispense(started.plan);
    const gates = new CashPresentationGateRegistry().register({
      id: "bank.mobileOtp",
      evaluate: async () => true,
    });
    const authorization = await new CashPresentationAuthorizer(gates).authorize({
      cashSessionId: started.session.id,
      operationId: "operation-1",
      policy,
    });
    await started.session.present(authorization);
    const result = await started.session.waitForTake();

    expect(result.outcome).toBe("taken");
    expect(fixture.calls.present).toBe(1);
    expect(result.safeSummary).not.toHaveProperty("cashUnits");
  });

  it("rejects a plan bound to another operation and an expired authorization", async () => {
    const fixture = createFixture();
    const first = await fixture.port.start(request(1_000));
    await first.session.abort("cancel");
    const second = await fixture.port.start({ ...request(1_000), operationId: "operation-2" });
    await expect(second.session.dispense(first.plan)).rejects.toThrow(/plan is stale/i);
    await second.session.dispense(second.plan);
    await expect(second.session.present({
      cashSessionId: second.session.id,
      expiresAt: 0,
      id: "expired",
      operationId: "operation-2",
      policyId: policy.id,
      policyVersion: policy.version,
      satisfiedGates: ["bank.mobileOtp"],
    })).rejects.toThrow(/authorization is invalid/i);
  });

  it("permanently removes foreground authority after recovery transfer", async () => {
    const transfers: unknown[] = [];
    const fixture = createFixture({
      recoveryTransfer: {
        acceptTransfer: async (input) => {
          transfers.push(input);
          return { fencingToken: 2, leaseId: "recovery-1", state: "recoveryBound" as const };
        },
      },
    });
    const started = await fixture.port.start(request(1_000));
    await started.session.dispense(started.plan);

    await expect(started.session.exit("routeExit")).resolves.toMatchObject({
      status: "transferred",
    });
    await expect(started.session.abort("cancel")).rejects.toThrow(/already transferred/i);
    expect(fixture.calls.present).toBe(0);
    expect(fixture.calls.retract).toBe(0);
    expect(transfers).toHaveLength(1);
  });
});

const policy: CashPresentationPolicy = {
  authorizationTtlMs: 10_000,
  id: "withdrawal.presentation",
  requiredGates: ["bank.mobileOtp"],
  takeTimeoutMs: 50,
  version: "1",
};

const request = (minorUnits: number) => ({
  amount: { currency: "USD", minorUnits },
  operationId: "operation-1",
  ownerInstanceId: "runtime-1",
  presentationPolicy: policy,
});

const createFixture = (options: {
  readonly failBefore?: boolean;
  readonly recoveryTransfer?: CashDeliveryDependencies["recoveryTransfer"];
} = {}) => {
  const calls = { denominate: 0, dispense: 0, present: 0, retract: 0, releaseLease: 0 };
  const evidence: CashOperationEvidence[] = [];
  let nextId = 0;
  const dependencies: CashDeliveryDependencies = {
    deviceLocks: new DeviceLockManager(),
    emergencySpool: { append: async (item) => { evidence.push(item); } },
    evidence: {
      append: async (item) => { evidence.push(item); return receipt(); },
      recordAfterSnapshot: async () => receipt(),
      recordBeforeMovement: async ({ evidence: item }) => {
        if (options.failBefore) throw new Error("before persistence failed");
        evidence.push(item);
        return receipt();
      },
    },
    idFactory: () => `cash-id-${++nextId}`,
    recoveryLeases: {
      acquire: async (input) => ({ ...input, fencingToken: 1, id: "recovery-1" }),
      close: async () => {},
      hasUnresolved: async () => false,
      update: async () => {},
    },
    recoveryTransfer: options.recoveryTransfer,
  };
  const cdm = {
    denominate: async ({ denomination }: { denomination: unknown }) => {
      calls.denominate += 1;
      return { denomination, native: { hResult: 0 } };
    },
    dispense: async () => { calls.dispense += 1; return { native: { hResult: 0 } }; },
    getCashUnitInfo: async () => ({
      cashUnits: [{
        cashUnitType: 3,
        count: 100,
        currencyId: "USD",
        dispensedCount: 0,
        name: "USD20",
        number: 1,
        physical: [],
        presentedCount: 0,
        rejectCount: 0,
        retractedCount: 0,
        status: 0,
        unitId: "cassette-1",
        values: 2_000,
      }],
      native: { hResult: 0 },
      tellerId: 0,
    }),
    getPresentStatus: async () => ({ native: { hResult: 0 }, position: 2, presentState: 2 }),
    present: async () => { calls.present += 1; return { hResult: 0 }; },
    retract: async () => { calls.retract += 1; return { native: { hResult: 0 } }; },
  };
  const commandLeases = {
    acquire: async (input: Record<string, unknown>) => ({ ...input, expiresAt: Date.now() + 10_000 }),
    getHostEpoch: async () => "epoch-1",
    release: async () => { calls.releaseLease += 1; },
  };
  const port = new XfsCashDeliveryPort({
    client: cdm as never,
    commandLeases: commandLeases as never,
    dependencies,
    deviceId: "cashDispenser",
    logicalName: "BANK_CDM_A",
    policy: { configurationRevision: "rev-1", policyVersion: "1" },
    session: { id: "cdm-session" },
    sessionGeneration: 1,
    timeoutMs: 1_000,
  });
  return { calls, evidence, port };
};

const receipt = () => ({ id: "receipt", persistedAt: new Date(0).toISOString() });
