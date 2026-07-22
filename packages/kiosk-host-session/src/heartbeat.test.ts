import { describe, expect, it } from "vitest";

import { HostSessionSupervisor } from "./supervisor";
import { TestHostSessionTransport, TestScheduler, testPolicy } from "./test-fixture";

describe("HostSessionSupervisor heartbeat", () => {
  it("degrades at the configured threshold and re-establishes the same generation", async () => {
    const scheduler = new TestScheduler();
    let establishCalls = 0;
    let heartbeatCalls = 0;
    const supervisor = new HostSessionSupervisor({
      id: "bsp.primary",
      policy: testPolicy,
      protocol: {
        establish: async () => {
          establishCalls += 1;
          return { status: "accepted" };
        },
        heartbeat: async () => {
          heartbeatCalls += 1;
          return { status: "failed", errorCode: "bsp.echo-rejected" };
        },
      },
      scheduler,
      transport: new TestHostSessionTransport(),
    });
    await supervisor.start();

    await scheduler.advanceBy(20);
    expect(supervisor.snapshot).toMatchObject({
      available: true,
      consecutiveHeartbeatFailures: 1,
    });

    await scheduler.advanceBy(20);
    expect(supervisor.snapshot).toMatchObject({ available: false, state: "degraded" });
    await scheduler.advanceBy(10);

    expect(heartbeatCalls).toBe(2);
    expect(establishCalls).toBe(2);
    expect(supervisor.snapshot).toMatchObject({ available: true, state: "ready" });
    await supervisor.dispose();
  });

  it("times out a control hook and schedules bounded establishment retry", async () => {
    const scheduler = new TestScheduler();
    const supervisor = new HostSessionSupervisor({
      id: "bsp.primary",
      policy: { ...testPolicy, heartbeat: undefined },
      protocol: { establish: async () => new Promise(() => undefined) },
      scheduler,
      transport: new TestHostSessionTransport(),
    });
    const starting = supervisor.start();

    await scheduler.advanceBy(50);
    await starting;

    expect(supervisor.snapshot).toMatchObject({
      reasonCode: "host.session-supervisor.control-timeout",
      state: "degraded",
    });
    await supervisor.dispose();
  });
});
