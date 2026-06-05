import { describe, expect, test } from "vitest";
import { createDemoKioskRuntime } from "./demo-runtime";

describe("demo kiosk runtime", () => {
  test("runs an approved ATM transaction through React UI actions", async () => {
    const runtime = createDemoKioskRuntime();
    const run = runtime.start("approved");

    await waitForScreen(runtime, "account.input");
    runtime.emitAction("account.input", { type: "submit", value: "123456" });

    await expect(run).resolves.toMatchObject({
      state: "completed",
      result: { flowId: "atm-basic", endName: "Success" },
    });
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
    await expect(declinedRun).resolves.toMatchObject({
      state: "completed",
      result: { flowId: "atm-basic", endName: "Declined" },
    });

    const failed = createDemoKioskRuntime();
    const failedRun = failed.start("failed");
    await waitForScreen(failed, "account.input");
    failed.emitAction("account.input", { type: "submit", value: "654321" });
    await expect(failedRun).resolves.toMatchObject({
      state: "completed",
      result: { flowId: "atm-basic", endName: "Failed" },
    });
  });

  test("routes cancel through the standard input step", async () => {
    const runtime = createDemoKioskRuntime();
    const run = runtime.start("approved");

    await waitForScreen(runtime, "account.input");
    runtime.emitAction("account.input", { type: "cancel" });

    await expect(run).resolves.toMatchObject({
      state: "completed",
      result: { flowId: "atm-basic", endName: "Cancelled" },
    });
    expect(runtime.store.getSnapshot().screenState).toMatchObject({ endName: "Cancelled" });
  });

  test("reset cancels an in-flight transaction and returns to welcome", async () => {
    const runtime = createDemoKioskRuntime();
    const run = runtime.start("approved");

    await waitForScreen(runtime, "account.input");
    await expect(runtime.reset("declined")).resolves.toMatchObject({
      state: "idle",
      metadata: { scenario: "declined" },
    });
    await expect(run).resolves.toMatchObject({ state: "cancelled" });
    expect(runtime.store.getSnapshot().currentScreen).toBe("demo.welcome");
    expect(runtime.store.getSnapshot().screenState).toMatchObject({ scenario: "declined" });
  });

  test("host suspend command blocks new transactions", async () => {
    const runtime = createDemoKioskRuntime();

    await expect(
      runtime.commands.execute("service.applyHostCommand", {
        traceId: "trace-suspend",
        command: { type: "suspendService", mode: "immediate", reason: "operator" },
      }),
    ).resolves.toMatchObject({ state: "suspended" });
    await expect(runtime.start("approved")).rejects.toMatchObject({ code: "service.suspended" });
  });

  test("host maintenance command cancels in-flight transaction", async () => {
    const runtime = createDemoKioskRuntime();
    const run = runtime.start("approved");

    await waitForScreen(runtime, "account.input");
    await expect(
      runtime.commands.execute("service.applyHostCommand", {
        traceId: "trace-maintenance",
        command: { type: "enterMaintenance", reason: "cash replenish" },
      }),
    ).resolves.toMatchObject({ state: "maintenance" });

    await expect(run).resolves.toMatchObject({ state: "cancelled" });
    await expect(runtime.queries.query("service.status", {})).resolves.toMatchObject({
      state: "maintenance",
    });
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
