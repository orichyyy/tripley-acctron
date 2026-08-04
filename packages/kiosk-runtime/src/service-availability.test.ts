import { describe, expect, it, vi } from "vitest";

import {
  ServiceAvailabilityCoordinator,
  type ServiceAvailabilityScheduler,
} from "./service-availability";

describe("ServiceAvailabilityCoordinator", () => {
  it("fails closed and recovers through the configured startup-gate retry", async () => {
    const scheduler = new ManualScheduler();
    const audit = { append: vi.fn(async () => undefined) };
    let available = false;
    const coordinator = new ServiceAvailabilityCoordinator({
      audit,
      gates: [{
        id: "security-material",
        evaluate: async () => available
          ? { available: true }
          : { available: false, reason: { code: "security.rqk.failed" } },
      }],
      retryIntervalMs: 180_000,
      scheduler,
    });

    await expect(coordinator.initialize()).resolves.toMatchObject({
      reason: { code: "security.rqk.failed" },
      status: "outOfService",
    });
    expect(() => coordinator.beginOperation()).toThrow(/blocked/i);
    expect(scheduler.delayMs).toBe(180_000);

    available = true;
    await scheduler.run();

    expect(coordinator.snapshot().status).toBe("available");
    expect(JSON.stringify(audit.append.mock.calls)).toContain(
      "Out of service, reason: security.rqk.failed",
    );
  });

  it("defers suspension until the active customer operation releases its lease", async () => {
    const coordinator = new ServiceAvailabilityCoordinator();
    await coordinator.initialize();
    const operation = coordinator.beginOperation();

    await coordinator.requestSuspension({ code: "host.requestedSuspension" });

    expect(coordinator.snapshot()).toMatchObject({
      activeOperationCount: 1,
      status: "suspensionPending",
    });
    await operation.release();
    expect(coordinator.snapshot()).toMatchObject({
      activeOperationCount: 0,
      reason: { code: "host.requestedSuspension" },
      status: "outOfService",
    });
  });
});

class ManualScheduler implements ServiceAvailabilityScheduler {
  callback: (() => void) | undefined;
  delayMs: number | undefined;

  schedule(callback: () => void, delayMs: number): unknown {
    this.callback = callback;
    this.delayMs = delayMs;
    return callback;
  }

  cancel(): void {
    this.callback = undefined;
  }

  async run(): Promise<void> {
    const callback = this.callback;
    this.callback = undefined;
    callback?.();
    await Promise.resolve();
    await Promise.resolve();
  }
}
