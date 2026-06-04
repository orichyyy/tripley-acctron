import { describe, expect, test } from "vitest";
import type { HostResponse, StepHandler } from "@tripley-acctron/contracts";
import {
  FakeHostGateway,
  type TestKioskAppOptions,
  VirtualClock,
  createFakeDevices,
  createTestKioskApp,
} from "@tripley-acctron/testing";
import { defineHostRequestStep } from "./skeleton-steps";

describe("host request step", () => {
  test("uses HostGateway and routes responses", async () => {
    const fakeHost = new FakeHostGateway();
    fakeHost.enqueueResponse({ approved: false });
    const kit = createHostStepTestKit(
      {
        input: defineHostRequestStep({
          id: "gatewayHost",
          messageType: "accountInquiry",
          body: () => ({ account: "123" }),
          route: (response: HostResponse<{ approved: boolean }>) =>
            response.body.approved ? "Approved" : "Declined",
        }),
      },
      fakeHost,
    );

    await expect(kit.flow.run("demo")).resolves.toEqual({
      flowId: "demo",
      endName: "Declined",
    });
    expect(fakeHost.sent).toEqual([
      {
        messageType: "accountInquiry",
        body: { account: "123" },
        options: { signal: expect.any(AbortSignal) },
      },
    ]);
  });

  test("fails clearly when HostGateway is missing", async () => {
    const kit = createHostStepTestKit({
      input: defineHostRequestStep({
        id: "missingHost",
        messageType: "accountInquiry",
        body: {},
        route: () => "Approved",
      }),
    });

    await expect(kit.flow.run("demo")).rejects.toMatchObject({ code: "host.missing" });
  });
});

function createHostStepTestKit(steps: Record<string, StepHandler>, host?: FakeHostGateway) {
  const devices = createFakeDevices();
  const clock = new VirtualClock();
  const appOptions: TestKioskAppOptions = {
    steps,
    devices,
    clock,
    flows: [
      {
        id: "demo",
        version: "1",
        nodes: [
          { id: "start", type: "start" },
          { id: "input", type: "action", action: "input" },
          { id: "approved", type: "end", name: "Approved" },
          { id: "declined", type: "end", name: "Declined" },
        ],
        edges: [
          { id: "start-input", from: "start", to: "input" },
          { id: "approved", from: "input", to: "approved", route: "Approved" },
          { id: "declined", from: "input", to: "declined", route: "Declined" },
        ],
      },
    ],
  };
  return createTestKioskApp(host ? { ...appOptions, host } : appOptions);
}
