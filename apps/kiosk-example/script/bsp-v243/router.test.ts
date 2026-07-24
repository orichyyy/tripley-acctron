import { describe, expect, it } from "vitest";

import { createBspV243SessionProfile } from "./composition";
import { packHostControl, packOexResponse, terminalSnapshot } from "./test-fixture";

describe("Taiwan BSP v2.43 frame routing", () => {
  it("routes OEX response and host-initiated line test without payload logging", () => {
    const profile = createBspV243SessionProfile({ terminalState: () => terminalSnapshot });

    expect(
      profile.routeFrame({
        payload: packOexResponse(profile.messages),
        pending: { channel: "bsp.primary", idempotencyKey: "bsp-v243:oex:1:request" },
      }),
    ).toMatchObject({ kind: "response" });
    expect(profile.routeFrame({ payload: packHostControl(profile.messages, "SNS") })).toMatchObject(
      {
        kind: "inbound",
        type: "bsp.control.line-test",
      },
    );
  });

  it("rejects wrong lengths and allows project response correlation extensions", () => {
    const profile = createBspV243SessionProfile({
      resolvePendingResponse: ({ code }) =>
        code === "XYZ" ? { responseId: "project-response" } : undefined,
      terminalState: () => terminalSnapshot,
    });

    expect(profile.routeFrame({ payload: Uint8Array.of(1) })).toEqual({
      kind: "ignore",
      reason: "bsp.v243.host-frame-length-invalid",
    });
    expect(
      profile.routeFrame({
        payload: packHostControl(profile.messages, "XYZ"),
        pending: { channel: "project", idempotencyKey: "project:request" },
      }),
    ).toEqual({ kind: "response", responseId: "project-response" });
  });
});
