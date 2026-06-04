import { describe, expect, test } from "vitest";
import { HeadlessWindowManager } from "./headless-window-manager";
import { NativeWindowManagerSkeleton } from "./native-window-manager";

describe("window coordinator", () => {
  test("opens, sends, broadcasts, and closes headless windows", async () => {
    const windows = new HeadlessWindowManager();
    const supervisor = await windows.openWindow({ role: "supervisorScreen" });
    const diagnostic = await windows.openWindow({ role: "diagnosticScreen" });

    await windows.sendToWindow(supervisor.id, { type: "ping" });
    await windows.broadcast({ type: "status" });
    await windows.closeWindow(diagnostic.id);

    expect(windows.messages).toEqual([
      { windowId: supervisor.id, message: { type: "ping" } },
      { windowId: supervisor.id, message: { type: "status" } },
      { windowId: diagnostic.id, message: { type: "status" } },
    ]);
    expect(windows.listWindows()).toEqual([supervisor]);
  });

  test("reports missing and unsupported native windows explicitly", async () => {
    const windows = new HeadlessWindowManager();
    await expect(windows.closeWindow("missing")).rejects.toMatchObject({ code: "window.notFound" });
    await expect(
      new NativeWindowManagerSkeleton().openWindow({ role: "supervisorScreen" }),
    ).rejects.toMatchObject({
      code: "window.nativeUnsupported",
    });
  });
});
