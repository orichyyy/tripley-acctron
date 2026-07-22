import { ConditionRegistry } from "@tripley-kit/web-container-condition-engine";
import { describe, expect, it } from "vitest";

import { createHostSessionHealthCheck, registerHostSessionReadyCondition } from "./integrations";
import { HostSessionSupervisor } from "./supervisor";
import { TestHostSessionTransport, TestScheduler, testPolicy } from "./test-fixture";

describe("host session UI and diagnostics integrations", () => {
  it("exposes readiness through condition and health adapters", async () => {
    const supervisor = new HostSessionSupervisor({
      id: "bsp.primary",
      policy: { ...testPolicy, heartbeat: undefined },
      protocol: { establish: async () => ({ status: "accepted" }) },
      scheduler: new TestScheduler(),
      transport: new TestHostSessionTransport(),
    });
    const conditions = new ConditionRegistry();
    const conditionId = registerHostSessionReadyCondition(conditions, supervisor);
    const health = createHostSessionHealthCheck(supervisor);

    expect(await conditions.evaluate(conditionId, {})).toMatchObject({
      allowed: false,
      reasonCode: "host.session.not-ready",
    });
    expect(await health.run()).toMatchObject({ status: "fail" });

    await supervisor.start();

    expect(await conditions.evaluate(conditionId, {})).toEqual({ allowed: true });
    expect(await health.run()).toMatchObject({ status: "pass" });
    await supervisor.dispose();
  });
});
