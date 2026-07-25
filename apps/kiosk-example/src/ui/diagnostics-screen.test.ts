import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { createExampleApplicationRuntime } from "../runtime/create-runtime";
import { WithdrawalDiagnosticsStore } from "../runtime/operator-diagnostics";
import { DiagnosticsScreen } from "./diagnostics-screen";

describe("DiagnosticsScreen", () => {
  it("renders safe Flow and terminal withdrawal evidence", async () => {
    const withdrawal = new WithdrawalDiagnosticsStore();
    withdrawal.publish({
      outcome: {
        card: { required: true, status: "returned" },
        cash: {
          afterSnapshotId: "after-ui-64",
          beforeSnapshotId: "before-ui-64",
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
          protocolMode: "authorization-only",
          protocolVersion: "2.43",
          status: "approved",
        },
        kind: "withdrawal.outcome",
        operationId: "operator-reference-64",
        policyId: "taiwan.bsp.v243.withdrawal",
        policyVersion: "1",
        reason: "cash-take-timeout",
        safeSummary: { secret: "DO-NOT-RENDER" },
        status: "timedOut",
      },
    });
    const application = await createExampleApplicationRuntime({
      mode: "memory",
      withdrawalBusiness: {
        diagnostics: withdrawal,
        execute: async () => ({ status: "unused" }),
      },
    });

    try {
      const markup = renderToStaticMarkup(
        createElement(
          MemoryRouter,
          undefined,
          createElement(DiagnosticsScreen, { application }),
        ),
      );

      expect(markup).toContain("Runtime evidence");
      expect(markup).toContain("cashNotTaken");
      expect(markup).toContain("operator-reference-64");
      expect(markup).toContain("retracted");
      expect(markup).toContain("before-ui-64");
      expect(markup).not.toContain("DO-NOT-RENDER");
    } finally {
      await application.dispose();
    }
  });
});
