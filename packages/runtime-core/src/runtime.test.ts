import { noopLogger } from "@tripley-kit/logger";
import { describe, expect, it, vi } from "vitest";
import { FakeClock, MemoryRecovery, MemoryTimeoutDecision } from "@tripley-acctron/testing";
import { ServiceStateController } from "./service-state.js";
import { TimeoutManager } from "./timeout-manager.js";
import { TransactionRuntime } from "./transaction-runtime.js";

describe("TransactionRuntime", () => {
  it("applies pending out-of-service after the active transaction", async () => {
    const state = new ServiceStateController();
    const runtime = new TransactionRuntime(state, new MemoryRecovery(), noopLogger);
    await runtime.run(async () => {
      state.requestAvailability("out-of-service");
    });
    expect(runtime.getSnapshot()).toEqual({
      availability: "out-of-service",
      transactionPhase: "idle",
    });
  });

  it("recovers and returns to idle after an unhandled failure", async () => {
    const recovery = new MemoryRecovery();
    const runtime = new TransactionRuntime(new ServiceStateController(), recovery, noopLogger);
    await expect(runtime.run(async () => Promise.reject(new Error("failed")))).rejects.toThrow(
      "failed",
    );
    expect(recovery.reasons).toHaveLength(1);
    expect(runtime.getSnapshot().transactionPhase).toBe("idle");
  });
});

describe("TimeoutManager", () => {
  it("resets an ask-more-time timeout when approved", async () => {
    const clock = new FakeClock();
    const onTimeout = vi.fn();
    const decision = new MemoryTimeoutDecision("yes");
    const manager = new TimeoutManager({ clock, decision, onTimeout });
    manager.start({ action: "ask-more-time", stepId: "account", timeoutMs: 90_000 });
    await clock.advanceBy(90_000);
    expect(decision.contexts).toHaveLength(1);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
