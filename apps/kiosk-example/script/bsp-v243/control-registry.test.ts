import { describe, expect, it, vi } from "vitest";

import { createBspV243SessionProfile } from "./composition";
import { packHostControl, terminalSnapshot } from "./test-fixture";

describe("Taiwan BSP v2.43 host control plugins", () => {
  it("dispatches a custom control contribution without framework changes", async () => {
    const handle = vi.fn(async () => undefined);
    const profile = createBspV243SessionProfile({
      controls: [{ code: "XYZ", handle, id: "project.xyz", type: "project.control.xyz" }],
      terminalState: () => terminalSnapshot,
    });
    const payload = packHostControl(profile.messages, "XYZ", "project control body");
    const route = profile.routeFrame({ payload });
    expect(route).toMatchObject({ kind: "inbound", type: "project.control.xyz" });
    if (route.kind !== "inbound") return;

    const result = await profile.inbound.dispatch(
      {
        generation: 2,
        messageId: route.messageId,
        payload,
        receivedAt: 1,
        type: route.type,
      },
      { respond: vi.fn(async () => ({ status: "sent" as const })) },
    );

    expect(result).toEqual({ status: "handled", handlerId: "project.xyz" });
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ atmId: "12345", body: "project control body", code: "XYZ" }),
      expect.objectContaining({ respond: expect.any(Function) }),
    );
  });

  it("leaves high-risk built-in commands unhandled until a project registers policy", async () => {
    const profile = createBspV243SessionProfile({ terminalState: () => terminalSnapshot });
    const payload = packHostControl(profile.messages, "RBT");
    const route = profile.routeFrame({ payload });
    expect(route).toMatchObject({ kind: "inbound", type: "bsp.control.reboot" });
    if (route.kind !== "inbound") return;

    await expect(
      profile.inbound.dispatch(
        { generation: 1, payload, receivedAt: 1, type: route.type },
        { respond: vi.fn(async () => ({ status: "sent" as const })) },
      ),
    ).resolves.toEqual({ status: "unhandled" });
  });
});
