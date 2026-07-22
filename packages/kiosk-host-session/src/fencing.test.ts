import { describe, expect, it } from "vitest";

import type { HostSessionControlResult } from "./contracts";
import { HostSessionSupervisor } from "./supervisor";
import {
  TestHostSessionTransport,
  TestScheduler,
  deferred,
  flushPromises,
  testPolicy,
} from "./test-fixture";

describe("HostSessionSupervisor generation fencing", () => {
  it("ignores a late establishment result from a retired generation", async () => {
    const scheduler = new TestScheduler();
    const transport = new TestHostSessionTransport();
    const first = deferred<HostSessionControlResult>();
    const supervisor = new HostSessionSupervisor({
      id: "bsp.primary",
      policy: { ...testPolicy, heartbeat: undefined },
      protocol: {
        establish: async ({ generation }) =>
          generation === 1 ? first.promise : { status: "accepted" },
      },
      scheduler,
      transport,
    });
    const starting = supervisor.start();
    await flushPromises();

    transport.disconnect();
    transport.connect();
    await flushPromises();
    first.resolve({ status: "accepted" });
    await starting;
    await flushPromises();

    expect(supervisor.snapshot).toMatchObject({ available: true, generation: 2, state: "ready" });
    await supervisor.dispose();
  });

  it("cancels active control work and rejects stale exchange after disposal", async () => {
    const transport = new TestHostSessionTransport();
    let capturedSignal: AbortSignal | undefined;
    let lateExchange: (() => Promise<unknown>) | undefined;
    const supervisor = new HostSessionSupervisor({
      id: "bsp.primary",
      policy: { ...testPolicy, heartbeat: undefined },
      protocol: {
        establish: async (context) => {
          capturedSignal = context.signal;
          lateExchange = () =>
            context.exchange({
              channel: "bsp",
              idempotencyKey: "late",
              payload: Uint8Array.of(1),
              timeoutMs: 10,
            });
          return new Promise(() => undefined);
        },
      },
      scheduler: new TestScheduler(),
      transport,
    });
    const starting = supervisor.start();
    await flushPromises();

    await supervisor.dispose();
    await starting;
    const result = await lateExchange?.();

    expect(capturedSignal?.aborted).toBe(true);
    expect(result).toMatchObject({
      errorCode: "host.session-supervisor.stale-generation",
      status: "notSent",
    });
    expect(transport.requests).toHaveLength(0);
  });
});
