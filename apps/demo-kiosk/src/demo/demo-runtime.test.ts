import { describe, expect, test } from "vitest";
import { createDemoKioskRuntime } from "./demo-runtime";

describe("demo kiosk runtime", () => {
  test("runs an approved ATM transaction through React UI actions", async () => {
    const runtime = createDemoKioskRuntime();
    const run = runtime.start("approved");

    await waitForScreen(runtime, "account.input");
    runtime.emitAction("account.input", { type: "submit", value: "123456" });

    await expect(run).resolves.toEqual({ flowId: "atm-basic", endName: "Success" });
    expect(runtime.store.getSnapshot().currentScreen).toBe("demo.result");
    expect(runtime.store.getSnapshot().screenState).toMatchObject({
      endName: "Success",
      accountNo: "123456",
    });
  });

  test("routes declined and failed host scenarios to result screens", async () => {
    const declined = createDemoKioskRuntime();
    const declinedRun = declined.start("declined");
    await waitForScreen(declined, "account.input");
    declined.emitAction("account.input", { type: "submit", value: "654321" });
    await expect(declinedRun).resolves.toEqual({ flowId: "atm-basic", endName: "Declined" });

    const failed = createDemoKioskRuntime();
    const failedRun = failed.start("failed");
    await waitForScreen(failed, "account.input");
    failed.emitAction("account.input", { type: "submit", value: "654321" });
    await expect(failedRun).resolves.toEqual({ flowId: "atm-basic", endName: "Failed" });
  });

  test("routes cancel through the standard input step", async () => {
    const runtime = createDemoKioskRuntime();
    const run = runtime.start("approved");

    await waitForScreen(runtime, "account.input");
    runtime.emitAction("account.input", { type: "cancel" });

    await expect(run).resolves.toEqual({ flowId: "atm-basic", endName: "Cancelled" });
    expect(runtime.store.getSnapshot().screenState).toMatchObject({ endName: "Cancelled" });
  });
});

async function waitForScreen(
  runtime: ReturnType<typeof createDemoKioskRuntime>,
  screen: string,
): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (runtime.store.getSnapshot().currentScreen === screen) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${screen}.`);
}
