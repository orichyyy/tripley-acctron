import { describe, expect, it } from "vitest";

import { HostSessionSupervisor } from "./supervisor";
import { TestHostSessionTransport, TestScheduler, testPolicy } from "./test-fixture";

describe("HostSessionSupervisor", () => {
  it("gates readiness on a project-owned establishment hook", async () => {
    const scheduler = new TestScheduler();
    const transport = new TestHostSessionTransport();
    const events: unknown[] = [];
    const supervisor = new HostSessionSupervisor({
      id: "bsp.primary",
      policy: testPolicy,
      protocol: {
        async establish(context) {
          const result = await context.exchange({
            channel: "bsp",
            idempotencyKey: `sign-on-${context.generation}`,
            payload: new TextEncoder().encode("sensitive-sign-on-wire-data"),
            timeoutMs: 25,
          });
          return result.status === "response"
            ? { status: "accepted" }
            : { status: "failed", errorCode: "bsp.sign-on-failed" };
        },
        heartbeat: async () => ({ status: "accepted" }),
      },
      scheduler,
      transport,
    });
    supervisor.onEvent((event) => events.push(event));

    await supervisor.start();

    expect(supervisor.snapshot).toMatchObject({ available: true, generation: 1, state: "ready" });
    expect(transport.requests).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("sensitive-sign-on-wire-data");
    await supervisor.dispose();
  });

  it("contains project hook exceptions behind a stable safe error code", async () => {
    const supervisor = new HostSessionSupervisor({
      id: "bsp.primary",
      policy: { ...testPolicy, heartbeat: undefined },
      protocol: { establish: async () => Promise.reject(new Error("PAN 123456789")) },
      scheduler: new TestScheduler(),
      transport: new TestHostSessionTransport(),
    });
    const events: unknown[] = [];
    supervisor.onEvent((event) => events.push(event));

    await supervisor.start();

    expect(supervisor.snapshot).toMatchObject({
      available: false,
      reasonCode: "host.session-supervisor.control-hook-failed",
      state: "degraded",
    });
    expect(JSON.stringify(events)).not.toContain("123456789");
    await supervisor.dispose();
  });
});
