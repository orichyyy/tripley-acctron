import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteAuditJournalRepository } from "@tripley-kit/web-container-kiosk-base";
import { MemoryScopedStore } from "@tripley-kit/web-container-scoped-store";
import { NodeSqliteConnection } from "@tripley-kit/web-container-storage-sqlite/node";
import type {
  CashDeliveryTerminalResult,
  CashInventorySnapshot,
} from "@tripley-kit/web-container-xfs-device-service";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BspV243IwdContext } from "../../script/bsp-v243/withdrawal-contracts";
import {
  TaiwanBspWithdrawalContextVault,
  createTaiwanBspWithdrawalHostContextProviders,
} from "./taiwan-bsp-withdrawal-context";
import { createTaiwanBspWithdrawalApplication } from "./taiwan-bsp-withdrawal";

describe("Taiwan BSP withdrawal application vertical slice", () => {
  const directories: string[] = [];
  afterEach(async () => Promise.all(
    directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  ));

  it("persists safe evidence, completes IWF, resets scope, and clears secrets", async () => {
    const fixture = await createFixture({ authorization: "approved", completion: true });
    const result = await fixture.application.execute(input("withdrawal-59-1"));

    expect(result.outcome).toMatchObject({
      cash: { custody: "taken", dispensed: true, presented: true, taken: true },
      card: { status: "returned" },
      host: { status: "approved" },
      status: "completed",
    });
    expect(result.finalization?.status).toBe("completed");
    expect(fixture.events).toEqual(expect.arrayContaining([
      "host.authorize",
      "cash.dispense",
      "card.return",
      "cash.present",
      "cash.waitForTake",
      "host.complete",
    ]));
    expect(fixture.completionContext).toMatchObject({
      ici: {
        inMac: "00000000",
        inPinBlock: "0000000000000000",
        inTrack3: "",
      },
      originalCenterSequence: "0745651",
    });
    expect(fixture.vault.has("withdrawal-59-1")).toBe(false);
    expect(fixture.scopedStore.scope("transaction", "withdrawal-59-1").keys()).toEqual([]);

    const transaction = await fixture.application.runtime.transactions.get("withdrawal-59-1");
    const audit = await new SqliteAuditJournalRepository(
      fixture.application.runtime.connection,
    ).listByTransaction("withdrawal-59-1");
    const safeEvidence = JSON.stringify({ audit, outcome: result.outcome, transaction });
    for (const secret of ["6222021234567890", "PIN-BLOCK-SECRET", "TRACK3-SECRET", "MAC-SECRET"]) {
      expect(safeEvidence).not.toContain(secret);
    }
    await fixture.application.dispose();
  });

  it("does not start CDM when IWD is declined", async () => {
    const fixture = await createFixture({ authorization: "declined", completion: true });
    const result = await fixture.application.execute(input("withdrawal-59-2"));

    expect(result.outcome).toMatchObject({
      cash: { dispensed: false, presented: false },
      host: { status: "declined" },
      reason: "host-declined",
      status: "declined",
    });
    expect(fixture.events).not.toContain("cash.start");
    expect(fixture.events).not.toContain("host.complete");
    expect(fixture.vault.has("withdrawal-59-2")).toBe(false);
    await fixture.application.dispose();
  });

  it("retracts staged cash and reports the real outcome to IWF on gate cancel", async () => {
    const fixture = await createFixture({
      authorization: "approved",
      completion: true,
      gate: "cancelled",
    });
    const result = await fixture.application.execute(input("withdrawal-59-3"));

    expect(result.outcome).toMatchObject({
      cash: { custody: "retracted", dispensed: true, presented: false, retracted: true },
      reason: "verification-cancelled",
      status: "cancelled",
      trigger: "cancel",
    });
    expect(fixture.events).toContain("cash.abort");
    expect(fixture.events).not.toContain("cash.present");
    expect(fixture.completedOutcome?.cash.custody).toBe("retracted");
    await fixture.application.dispose();
  });
});

const createFixture = async (options: {
  readonly authorization: "approved" | "declined";
  readonly completion: boolean;
  readonly gate?: "cancelled";
}) => {
  const directory = await mkdtemp(join(tmpdir(), "tripley-target59-"));
  const vault = new TaiwanBspWithdrawalContextVault();
  const providers = createTaiwanBspWithdrawalHostContextProviders(vault);
  const events: string[] = [];
  let completionContext: Awaited<ReturnType<typeof providers.completion>> | undefined;
  let completedOutcome: Parameters<typeof providers.completion>[0]["outcome"] | undefined;
  const host = {
    authorize: vi.fn(async (request: { operationId: string }) => {
      events.push("host.authorize");
      await providers.authorization(request);
      return options.authorization === "approved"
        ? { authorizationReference: "0745651", status: "approved" as const }
        : { reasonCode: "9123", status: "declined" as const };
    }),
    complete: vi.fn(async (request: Parameters<typeof providers.completion>[0]) => {
      events.push("host.complete");
      completedOutcome = request.outcome;
      completionContext = await providers.completion(request);
    }),
  };
  const session = {
    id: "cash-session-59",
    phase: "planned" as const,
    isTerminal: false,
    abort: vi.fn(async () => {
      events.push("cash.abort");
      session.isTerminal = true;
      return terminal("retracted");
    }),
    dispense: vi.fn(async () => { events.push("cash.dispense"); }),
    exit: vi.fn(async () => ({ status: "terminal" as const, result: terminal("retracted") })),
    present: vi.fn(async () => { events.push("cash.present"); }),
    waitForTake: vi.fn(async () => {
      events.push("cash.waitForTake");
      session.isTerminal = true;
      return terminal("taken");
    }),
  };
  const cash = {
    start: vi.fn(async () => {
      events.push("cash.start");
      return {
        before: snapshot("before"),
        plan: {
          cashSessionId: session.id,
          cashUnitRevision: "rev-1",
          denomination: { amount: 10_000, cashBox: 0, currencyId: "TWD", values: new Uint8Array() },
          expiresAt: Date.now() + 10_000,
          id: "plan-59",
          logicalService: "CashDispenser1",
          operationId: "withdrawal-59",
          policyVersion: "1",
          sessionGeneration: 1,
        },
        session,
      };
    }),
  };
  const scopedStore = new MemoryScopedStore();
  const application = await createTaiwanBspWithdrawalApplication({
    card: { returnCard: async () => {
      events.push("card.return");
      return {
        authorityReleased: true,
        logicalService: "CardReader1",
        mediaState: "notPresent" as const,
        operationId: "withdrawal-59",
        reason: "taken" as const,
        safeSummary: { status: "returned" },
        status: "returned" as const,
      };
    } },
    cash,
    db: new NodeSqliteConnection(join(directory, "transactions.db")),
    host,
    hostFinancialCompletion: options.completion,
    ownerInstanceId: "kiosk-target59",
    prePresentGates: options.gate ? [{
      evaluate: async () => ({ status: "cancelled" as const }),
      id: "mobile-otp",
    }] : [],
    protection: { recover: async () => ({ safeSummary: {}, status: "ready" as const }) },
    scopedStore,
    vault,
  });
  return {
    application,
    get completedOutcome() { return completedOutcome; },
    get completionContext() { return completionContext; },
    directory,
    events,
    scopedStore,
    vault,
  };
};

const input = (operationId: string) => ({
  amount: { currency: "TWD", minorUnits: 10_000 },
  bspContext: bspContext(),
  entryMode: "contact-card" as const,
  operationId,
  safeMetadata: { channel: "atm" },
});

const bspContext = (): BspV243IwdContext => ({
  header: {
    atmId: "00000",
    businessDate: "01150724",
    sequence: "00000176",
    systemDate: "01150724",
    versionDate: "20260723",
    versionMarker: "A",
  },
  ici: {
    inBankNumber: "807",
    inCardAccount: "6222021234567890",
    inCurrencyCode: "01",
    inMac: "MAC-SECRET",
    inPinBlock: "PIN-BLOCK-SECRET",
    inTrack3: "TRACK3-SECRET",
    inTransactionAccount: "0001801800002094",
    inTransactionAmount: "00010000",
  },
});

const terminal = (outcome: "taken" | "retracted"): CashDeliveryTerminalResult => ({
  after: snapshot("after"),
  outcome,
  reconciliationRequired: false,
  safeSummary: { outcome },
});

const snapshot = (boundary: "before" | "after"): CashInventorySnapshot => ({
  boundary,
  capturedAt: "2026-07-24T00:00:00.000Z",
  cashSessionId: "cash-session-59",
  certainty: "observed",
  id: `${boundary}-snapshot-59`,
  logicalService: "CashDispenser1",
  operationId: "withdrawal-59",
  revision: "revision-59",
  source: "device",
  units: [],
});
