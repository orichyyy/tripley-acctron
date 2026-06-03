import { describe, expect, test } from "vitest";
import { HeadlessUiAdapter } from "./headless-ui-adapter";
import { VirtualClock } from "./virtual-clock";

import type { ScreenMap } from "@tripley-acctron/contracts";

type Screens = ScreenMap & {
  idle: {
    state: { text: string };
    actions: { type: "start" };
  };
};

describe("testing helpers", () => {
  test("headless ui records show and resolves actions", async () => {
    const ui = new HeadlessUiAdapter<Screens>();
    await ui.show("idle", { text: "ready" });
    const action = ui.waitAction("idle");

    ui.emitAction("idle", { type: "start" });

    expect(ui.history).toEqual([{ type: "show", screen: "idle", payload: { text: "ready" } }]);
    await expect(action).resolves.toEqual({ type: "start" });
  });

  test("virtual clock runs due tasks", () => {
    const clock = new VirtualClock();
    let fired = false;

    const timer = clock.setTimeout(() => {
      fired = true;
    }, 100);
    clock.advanceBy(100);

    expect(fired).toBe(true);
    timer.cancel();
  });
});
