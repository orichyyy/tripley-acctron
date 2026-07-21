import { describe, expect, it } from "vitest";

import { runHostdCimTransaction } from "./cim-smoke";
import { xfsHostdTestConfigFromEnv } from "./config";

const confirmation = "I_UNDERSTAND_SIMULATOR_ONLY";
const describeReal = process.env.XFS_REAL_CIM_TRANSACTION_SMOKE === confirmation
  ? describe
  : describe.skip;

describeReal("hostd-backed CIM transaction vertical slice", () => {
  it("uses requiredModules, a fenced lease, and simulator automation to commit cash", async () => {
    const summary = await runHostdCimTransaction(xfsHostdTestConfigFromEnv());

    expect(summary.logicalName.length).toBeGreaterThan(0);
    expect(summary.noteCount).toBe(2);
    expect(summary.afterRevision).not.toBe(summary.beforeRevision);
  });
});

