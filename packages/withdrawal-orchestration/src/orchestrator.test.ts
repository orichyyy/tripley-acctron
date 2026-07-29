import { describe, expect, it } from "vitest";

import { createFixture, retainedCard, terminal } from "./orchestrator.test-fixture";

describe("WithdrawalOrchestrator", () => {
  it("retracts staged cash when a cardless OTP gate is cancelled", async () => {
    const fixture = createFixture({
      entryMode: "cardless-reservation",
      gateResult: { reasonCode: "CUSTOMER.CANCEL", status: "cancelled" },
    });

    const result = await fixture.orchestrator.execute(fixture.request);

    expect(result.outcome.status).toBe("cancelled");
    expect(result.outcome.reason).toBe("verification-cancelled");
    expect(result.outcome.trigger).toBe("cancel");
    expect(result.outcome.cash).toMatchObject({
      dispensed: true,
      presented: false,
      retracted: true,
      custody: "retracted",
    });
    expect(fixture.session.present).not.toHaveBeenCalled();
    expect(fixture.events).toEqual(expect.arrayContaining([
      "cash.dispense",
      "gate.otp",
      "cash.abort",
      "transaction.finalize",
      "audit.withdrawal.terminal",
      "scope.reset",
    ]));
  });

  it("blocks cash presentation when card-first custody is not returned", async () => {
    const fixture = createFixture({
      cardOrder: "return-before-cash-present",
      cardResult: retainedCard(),
      entryMode: "contact-card",
    });

    const result = await fixture.orchestrator.execute(fixture.request);

    expect(result.outcome.status).toBe("timedOut");
    expect(result.outcome.reason).toBe("card-take-timeout");
    expect(result.outcome.card).toMatchObject({ status: "retained", reason: "take-timeout" });
    expect(result.outcome.cash).toMatchObject({ presented: false, retracted: true });
    expect(fixture.session.present).not.toHaveBeenCalled();
    expect(fixture.events.indexOf("card.return")).toBeLessThan(fixture.events.indexOf("cash.abort"));
  });

  it("fails closed when a contact-card project omits the custody port", async () => {
    const fixture = createFixture({
      cardAvailable: false,
      cardOrder: "return-before-cash-present",
      entryMode: "contact-card",
    });

    const result = await fixture.orchestrator.execute(fixture.request);

    expect(result.outcome).toMatchObject({
      card: { status: "intervention" },
      reason: "card-custody-unresolved",
      status: "intervention",
    });
    expect(fixture.session.present).not.toHaveBeenCalled();
    expect(fixture.session.abort).toHaveBeenCalledOnce();
  });

  it("records cash take before returning the card in cash-first regions", async () => {
    const fixture = createFixture({
      cardOrder: "return-after-cash-terminal",
      entryMode: "contact-card",
    });

    const result = await fixture.orchestrator.execute(fixture.request);

    expect(result.outcome.status).toBe("completed");
    expect(result.outcome.cash).toMatchObject({ presented: true, taken: true, custody: "taken" });
    expect(result.outcome.card.status).toBe("returned");
    expect(fixture.events.indexOf("cash.waitForTake")).toBeLessThan(
      fixture.events.indexOf("card.return"),
    );
  });

  it("keeps cash presentation and retraction facts separate on take timeout", async () => {
    const fixture = createFixture({ cashTerminal: terminal("retracted", "after-timeout") });

    const result = await fixture.orchestrator.execute(fixture.request);

    expect(result.outcome.status).toBe("timedOut");
    expect(result.outcome.reason).toBe("cash-take-timeout");
    expect(result.outcome.cash).toMatchObject({
      afterSnapshotId: "after-timeout",
      presented: true,
      taken: false,
      retracted: true,
    });
  });

  it("omits Host Financial Completion for authorization-only projects", async () => {
    const fixture = createFixture({ protocolMode: "authorization-only" });

    const result = await fixture.orchestrator.execute(fixture.request);

    expect(result.finalization?.status).toBe("completed");
    expect(fixture.host.complete).not.toHaveBeenCalled();
    expect(fixture.transactions.finish).toHaveBeenCalledOnce();
    expect(fixture.scopedState.reset).toHaveBeenCalledOnce();
  });

  it("runs optional Host Financial Completion after every local finalizer", async () => {
    const fixture = createFixture({
      completion: true,
      protocolMode: "authorization-then-completion",
    });

    await fixture.orchestrator.execute(fixture.request);

    expect(fixture.host.complete).toHaveBeenCalledOnce();
    expect(fixture.events.slice(-4)).toEqual([
      "transaction.finalize",
      "audit.withdrawal.terminal",
      "scope.reset",
      "host.complete",
    ]);
  });

  it("fails admission before host or device activity when recovery is unresolved", async () => {
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

  it("passes a denomination plan to host when project policy plans cash first", async () => {
    const fixture = createFixture({
      cashPlanningOrder: "cash-planning-before-authorization",
    });

    await fixture.orchestrator.execute(fixture.request);

    expect(fixture.events.indexOf("cash.start")).toBeLessThan(
      fixture.events.indexOf("host.authorize"),
    );
    expect(fixture.host.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        cashPlan: expect.objectContaining({ id: "plan-1" }),
      }),
    );
  });

  it("releases a planned session without dispensing when host declines", async () => {
    const fixture = createFixture({
      authorization: "declined",
      cashPlanningOrder: "cash-planning-before-authorization",
    });

    const result = await fixture.orchestrator.execute(fixture.request);

    expect(result.outcome.reason).toBe("host-declined");
    expect(fixture.session.dispense).not.toHaveBeenCalled();
    expect(fixture.session.abort).toHaveBeenCalledOnce();
    expect(fixture.events).toEqual(expect.arrayContaining([
      "cash.start",
      "host.authorize",
      "cash.abort",
    ]));
  });
});
