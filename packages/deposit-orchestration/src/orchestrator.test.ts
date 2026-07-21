import { describe, expect, it } from "vitest";

import { createFixture, returnedResult, snapshot } from "./orchestrator.test-fixture";

describe("DepositOrchestrator", () => {
  it("commits the latest immutable escrow revision after multiple batches", async () => {
    const fixture = createFixture({
      reviewResults: [{ decision: "accept-more" }, { decision: "confirm" }],
      snapshots: [snapshot(1, 0), snapshot(2, 0)],
    });

    const result = await fixture.orchestrator.execute(fixture.request);

    expect(result.outcome).toMatchObject({
      escrow: { batchCount: 2, revision: 2, snapshotHash: "snapshot-2" },
      physical: { commit: "completed", committed: true },
      reason: "committed",
      status: "completed",
    });
    expect(fixture.session.commit).toHaveBeenCalledOnce();
    expect(fixture.events.indexOf("inventory.before")).toBeLessThan(fixture.events.indexOf("cash.start"));
    expect(fixture.events.indexOf("host.authorize")).toBeLessThan(fixture.events.indexOf("cash.commit"));
  });

  it("rolls back and records returned-and-taken media on customer cancel", async () => {
    const fixture = createFixture({ reviewResults: [{ decision: "cancelled" }] });

    const result = await fixture.orchestrator.execute(fixture.request);

    expect(result.outcome.status).toBe("cancelled");
    expect(result.outcome.reason).toBe("customer-cancelled");
    expect(result.outcome.trigger).toBe("cancel");
    expect(result.outcome.portions).toEqual(expect.arrayContaining([
      expect.objectContaining({ custody: "customer", kind: "returned" }),
    ]));
    expect(fixture.session.commit).not.toHaveBeenCalled();
  });

  it("records known retract custody after a return timeout", async () => {
    const fixture = createFixture({
      abortResult: returnedResult("retract-unit"),
      reviewResults: [{ decision: "timedOut" }],
    });

    const result = await fixture.orchestrator.execute(fixture.request);

    expect(result.outcome.status).toBe("timedOut");
    expect(result.outcome.portions[0]).toMatchObject({ custody: "retract-unit" });
    expect(result.outcome.trigger).toBe("timeout");
  });

  it("rolls back and never commits when host authorization declines", async () => {
    const fixture = createFixture({ hostApproved: false });

    const result = await fixture.orchestrator.execute(fixture.request);

    expect(result.outcome.status).toBe("declined");
    expect(result.outcome.reason).toBe("host-declined");
    expect(fixture.session.abort).toHaveBeenCalledOnce();
    expect(fixture.session.commit).not.toHaveBeenCalled();
  });

  it("does not retry an uncertain physical commit", async () => {
    const fixture = createFixture({
      abortResult: {
        ...returnedResult("unknown"),
        reason: "recovery-required",
      },
      commitError: true,
    });

    const result = await fixture.orchestrator.execute(fixture.request);

    expect(result.outcome.status).toBe("intervention");
    expect(result.outcome.reason).toBe("physical-commit-unknown");
    expect(result.outcome.physical).toMatchObject({
      commit: "execution-unknown",
      reconciliationRequired: true,
    });
    expect(fixture.session.commit).toHaveBeenCalledOnce();
  });

  it("does not send Host Financial Completion for an uncertain physical commit", async () => {
    const fixture = createFixture({
      abortResult: {
        ...returnedResult("unknown"),
        reason: "recovery-required",
      },
      commitError: true,
      completion: true,
      protocolMode: "authorization-then-completion",
    });

    await fixture.orchestrator.execute(fixture.request);

    expect(fixture.host.complete).not.toHaveBeenCalled();
  });

  it("fails closed when refused media custody cannot be resolved", async () => {
    const fixture = createFixture({
      refusedResolution: { status: "unknown" },
      snapshots: [snapshot(1, 2)],
    });

    const result = await fixture.orchestrator.execute(fixture.request);

    expect(result.outcome.status).toBe("intervention");
    expect(result.outcome.reason).toBe("refused-media-unresolved");
    expect(result.outcome.portions).toEqual(expect.arrayContaining([
      expect.objectContaining({ custody: "unknown", kind: "refused", noteCount: 2 }),
    ]));
    expect(fixture.session.commit).not.toHaveBeenCalled();
  });

  it("keeps local finalization independent from optional host completion", async () => {
    const authorizationOnly = createFixture({ protocolMode: "authorization-only" });
    const completion = createFixture({
      completion: true,
      protocolMode: "authorization-then-completion",
    });

    await authorizationOnly.orchestrator.execute(authorizationOnly.request);
    await completion.orchestrator.execute(completion.request);

    expect(authorizationOnly.host.complete).not.toHaveBeenCalled();
    expect(completion.events.slice(-4)).toEqual([
      "transaction.finalize",
      "audit.deposit.terminal",
      "scope.reset",
      "host.complete",
    ]);
  });

  it("preserves commit fact when after-inventory capture requires reconciliation", async () => {
    const fixture = createFixture({ inventoryAfterError: true });

    const result = await fixture.orchestrator.execute(fixture.request);

    expect(result.outcome.status).toBe("intervention");
    expect(result.outcome.reason).toBe("inventory-after-failed");
    expect(result.outcome.physical.committed).toBe(true);
    expect(result.outcome.inventory.afterCaptureFailed).toBe(true);
  });

  it("blocks admission before host and CIM activity while recovery is unresolved", async () => {
    const fixture = createFixture({ recoveryStatus: "intervention" });

    const result = await fixture.orchestrator.execute(fixture.request);

    expect(result.outcome).toMatchObject({
      reason: "recovery-barrier-blocked",
      status: "intervention",
    });
    expect(result.finalization).toBeUndefined();
    expect(fixture.host.authorize).not.toHaveBeenCalled();
    expect(fixture.cash.start).not.toHaveBeenCalled();
    expect(fixture.transactions.start).not.toHaveBeenCalled();
  });
});
