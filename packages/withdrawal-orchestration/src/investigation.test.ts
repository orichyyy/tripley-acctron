import {
  AuditJournalService,
  InMemoryAuditJournalRepository,
  InMemoryTransactionRepository,
} from "@tripley-kit/web-container-kiosk-base";
import type {
  CashInventorySnapshot,
  CashUnitObservation,
} from "@tripley-kit/web-container-xfs-device-service";
import { describe, expect, it } from "vitest";

import {
  createKioskBaseWithdrawalAuditAdapter,
  createKioskBaseWithdrawalTransactionAdapter,
} from "./kiosk-base-adapters";
import {
  createWithdrawalInvestigationRecord,
  type WithdrawalInvestigationRenderer,
} from "./investigation";
import {
  createFixture,
  retainedCard,
  terminal,
} from "./orchestrator.test-fixture";

describe("withdrawal investigation evidence", () => {
  it("classifies host decline without starting cash movement", async () => {
    const fixture = createFixture({ authorization: "declined" });
    const result = await fixture.orchestrator.execute(fixture.request);
    const record = createWithdrawalInvestigationRecord(result.outcome);

    expect(record.failureReason).toBe("hostDeclined");
    expect(record.cash.dispensed).toBe(false);
    expect(fixture.cash.start).not.toHaveBeenCalled();
  });

  it("distinguishes cancel, card-not-taken, and cash-not-taken", async () => {
    const cancelled = createFixture({
      gateResult: { reasonCode: "CUSTOMER.CANCEL", status: "cancelled" },
    });
    const card = createFixture({
      cardResult: retainedCard(),
      entryMode: "contact-card",
    });
    const cash = createFixture({
      cashTerminal: terminal("retracted", "after-timeout"),
    });

    const records = await Promise.all([
      cancelled.orchestrator.execute(cancelled.request),
      card.orchestrator.execute(card.request),
      cash.orchestrator.execute(cash.request),
    ]).then((results) =>
      results.map(({ outcome }) => createWithdrawalInvestigationRecord(outcome)),
    );

    expect(records.map(({ failureReason }) => failureReason)).toEqual([
      "cancelled",
      "cardNotTaken",
      "cashNotTaken",
    ]);
    expect(records[1]?.cash.presented).toBe(false);
    expect(records[2]?.cash).toMatchObject({
      presented: true,
      retracted: true,
      taken: false,
    });
  });

  it("classifies an injected dispense failure and preserves safe terminal facts", async () => {
    const fixture = createFixture({
      dispenseError: new Error("simulated CDM dispense failure"),
    });
    const result = await fixture.orchestrator.execute(fixture.request);
    const record = createWithdrawalInvestigationRecord(result.outcome);

    expect(record).toMatchObject({
      failureReason: "dispenseFailed",
      cash: { presented: false, taken: false },
      requiresManualReconciliation: true,
    });
  });

  it("joins verified cassette snapshots and allows a bank-specific renderer", async () => {
    const fixture = createFixture({
      cashTerminal: terminal("retracted", "after-timeout"),
    });
    const result = await fixture.orchestrator.execute(fixture.request);
    const record = createWithdrawalInvestigationRecord(result.outcome, {
      after: snapshot("after-timeout", "after", 98),
      before: snapshot("before-1", "before", 100),
    });
    const renderer: WithdrawalInvestigationRenderer<string> = {
      id: "bank.example.ej",
      render: (item) =>
        `${item.failureReason}|${item.cash.inventory.before?.units[0]?.count}|${item.cash.inventory.after?.units[0]?.count}`,
    };

    expect(renderer.render(record)).toBe("cashNotTaken|100|98");
    expect(record.cash.inventory.before?.units[0]).toMatchObject({
      denominationMinorUnits: 10_000,
      count: 100,
    });
    expect(() =>
      createWithdrawalInvestigationRecord(result.outcome, {
        before: snapshot("wrong-snapshot", "before", 100),
      }),
    ).toThrow(/does not match outcome evidence/);
  });

  it("persists canonical failure reason in transaction metadata and EJ data", async () => {
    const fixture = createFixture({
      cashTerminal: terminal("retracted", "after-timeout"),
    });
    const { outcome } = await fixture.orchestrator.execute(fixture.request);
    const transactions = new InMemoryTransactionRepository();
    const auditRepository = new InMemoryAuditJournalRepository();
    const transactionPort = createKioskBaseWithdrawalTransactionAdapter(transactions);
    const auditPort = createKioskBaseWithdrawalAuditAdapter(
      new AuditJournalService(auditRepository),
    );
    await transactions.create({
      businessType: "withdrawal",
      id: outcome.operationId,
    });

    await transactionPort.finish(outcome);
    await auditPort.append({
      data: createWithdrawalInvestigationRecord(outcome).safeSummary,
      eventId: "withdrawal.terminal",
      message: "terminal",
      operationId: outcome.operationId,
    });

    const transaction = await transactions.get(outcome.operationId);
    const audit = await auditRepository.listByTransaction(outcome.operationId);
    expect(transaction?.metadata).toMatchObject({
      withdrawalFailureReason: "cashNotTaken",
      cashAfterSnapshotId: "after-timeout",
    });
    expect(audit[0]?.data).toMatchObject({
      failureReason: "cashNotTaken",
      cashAfterSnapshotId: "after-timeout",
    });
  });
});

function snapshot(
  id: string,
  boundary: "before" | "after",
  count: number,
): CashInventorySnapshot {
  return {
    boundary,
    capturedAt: "2026-07-25T00:00:00.000Z",
    cashSessionId: "cash-session-1",
    certainty: "observed",
    id,
    logicalService: "CDM1",
    operationId: "withdrawal-1",
    revision: `revision-${boundary}`,
    source: "device",
    units: [cashUnit(count)],
  };
}

function cashUnit(count: number): CashUnitObservation {
  return {
    count,
    currency: "TWD",
    denominationMinorUnits: 10_000,
    dispensedCount: 2,
    logicalSlot: 1,
    presentedCount: 2,
    rejectCount: 0,
    retractedCount: 2,
    status: 0,
    type: 1,
  };
}
