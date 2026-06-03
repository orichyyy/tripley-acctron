import { describe, expect, it } from "vitest";
import { runHeadlessAtmExample } from "./index.js";

describe("headless ATM example", () => {
  it("records choices, defers pause and recovers failures", async () => {
    const result = await runHeadlessAtmExample();
    expect(result.journal).toHaveLength(2);
    expect(result.recoveries).toHaveLength(1);
    expect(result.snapshot).toEqual({ availability: "in-service", transactionPhase: "idle" });
  });
});
