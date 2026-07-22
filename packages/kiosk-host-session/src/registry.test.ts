import { describe, expect, it, vi } from "vitest";

import type { HostSessionSupervisorPort } from "./contracts";
import { HostSessionRuntime, HostSessionSupervisorRegistry } from "./registry";

const stubSupervisor = (id: string, available: boolean): HostSessionSupervisorPort => ({
  id,
  snapshot: {
    available,
    changedAt: 0,
    consecutiveHeartbeatFailures: 0,
    generation: 1,
    id,
    state: available ? "ready" : "degraded",
  },
  dispose: vi.fn(async () => undefined),
  onEvent: () => ({ unsubscribe: () => undefined }),
  start: vi.fn(async () => undefined),
});

describe("HostSessionRuntime", () => {
  it("fails startup when a required session is not ready and disposes started sessions", async () => {
    const ready = stubSupervisor("secondary", true);
    const unavailable = stubSupervisor("primary", false);
    const registry = new HostSessionSupervisorRegistry()
      .register(ready)
      .register(unavailable, { startup: "required" });
    const runtime = new HostSessionRuntime(registry);

    await expect(runtime.start()).rejects.toThrow("host.session.required-not-ready:primary");
    expect(ready.dispose).toHaveBeenCalledOnce();
    expect(unavailable.dispose).toHaveBeenCalledOnce();
  });

  it("permits a degraded optional session and freezes registrations", async () => {
    const registry = new HostSessionSupervisorRegistry().register(stubSupervisor("primary", false));
    const runtime = new HostSessionRuntime(registry);

    await runtime.start();

    expect(registry.snapshots()[0]).toMatchObject({ available: false });
    expect(() => registry.register(stubSupervisor("late", true))).toThrow("frozen");
    await runtime.dispose();
  });
});
