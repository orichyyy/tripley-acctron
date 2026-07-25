import type { WithdrawalExecutionResult } from "@tripley-kit/web-container-withdrawal-orchestration";
import { describe, expect, it, vi } from "vitest";

import { WithdrawalDiagnosticsStore } from "./operator-diagnostics";

describe("WithdrawalDiagnosticsStore", () => {
  it("publishes canonical custody evidence without forwarding arbitrary safe summary fields", () => {
    const store = new WithdrawalDiagnosticsStore();
    const listener = vi.fn();
    store.subscribe(listener);

    const evidence = store.publish(failedResult());

    expect(evidence).toMatchObject({
      card: { status: "returned" },
      cash: {
        afterSnapshotId: "cash-after-64",
        beforeSnapshotId: "cash-before-64",
        custody: "retracted",
        presented: true,
        retracted: true,
        taken: false,
      },
      failureReason: "cashNotTaken",
      host: { protocol: "taiwan.bsp@2.43", status: "approved" },
      operationId: "target64-operation",
      requiresManualReconciliation: false,
      status: "timedOut",
    });
    expect(store.snapshot()).toMatchObject({ latest: evidence, revision: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(store.snapshot())).not.toContain("4111111111111111");
    expect(JSON.stringify(store.snapshot())).not.toContain("SECRET-PIN-BLOCK");
  });
});

const failedResult = (): WithdrawalExecutionResult => ({
  outcome: {
    card: {
      authorityReleased: true,
      required: true,
      status: "returned",
    },
    cash: {
      afterSnapshotId: "cash-after-64",
      beforeSnapshotId: "cash-before-64",
      custody: "retracted",
      dispense: "completed",
      dispensed: true,
      present: "completed",
      presented: true,
      reconciliationRequired: false,
      retracted: true,
      taken: false,
    },
    entryMode: "contact-card",
    host: {
      protocolId: "taiwan.bsp",
      protocolMode: "authorization-then-completion",
      protocolVersion: "2.43",
      status: "approved",
    },
    kind: "withdrawal.outcome",
    operationId: "target64-operation",
    policyId: "taiwan.bsp.v243.withdrawal",
    policyVersion: "1",
    reason: "cash-take-timeout",
    safeSummary: {
      pan: "4111111111111111",
      pinBlock: "SECRET-PIN-BLOCK",
    },
    status: "timedOut",
    trigger: "timeout",
  },
});
