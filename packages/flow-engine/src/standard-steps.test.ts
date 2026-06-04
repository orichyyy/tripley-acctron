import { describe, expect, test } from "vitest";
import type { StepHandler } from "@tripley-acctron/contracts";
import {
  type TestKioskAppOptions,
  VirtualClock,
  createFakeDevices,
  createTestKioskApp,
} from "@tripley-acctron/testing";
import { InputSources } from "./input-sources";
import { defineChoiceStep } from "./choice-step";
import { defineConfirmStep } from "./confirm-step";
import { defineHostRequestStep, defineWaitDeviceStep } from "./skeleton-steps";
import { defineTextInputStep } from "./text-input-step";

describe("standard step kit", () => {
  test("text input accepts pinpad account and commits", async () => {
    const committed: string[] = [];
    const kit = createStandardStepTestKit({
      input: defineTextInputStep({
        id: "input",
        screen: "input",
        value: { minLength: 6, maxLength: 18 },
        sources: [InputSources.pinpad.numeric()],
        commit: (_ctx, value) => {
          committed.push(value);
        },
        routes: { accepted: "Valid", cancelled: "Cancelled", timeout: "Timeout" },
      }),
    });

    const run = kit.flow.run("demo");
    for (const key of ["1", "2", "3", "4", "5", "6", "enter"] as const) {
      kit.devices.pinpad.press(key);
      await flushPromises();
    }

    await expect(run).resolves.toEqual({ flowId: "demo", endName: "Valid" });
    expect(committed).toEqual(["123456"]);
    expect(kit.devices.pinpad.cancelled).toBe(true);
  });

  test("text input shows validation error and continues", async () => {
    const kit = createStandardStepTestKit({
      input: defineTextInputStep({
        id: "input",
        screen: "input",
        value: { minLength: 4 },
        sources: [InputSources.pinpad.numeric()],
        routes: { accepted: "Valid" },
      }),
    });

    const run = kit.flow.run("demo");
    for (const key of ["1", "2", "enter"] as const) {
      kit.devices.pinpad.press(key);
      await flushPromises();
    }
    for (const key of ["3", "4", "enter"] as const) {
      kit.devices.pinpad.press(key);
      await flushPromises();
    }

    await expect(run).resolves.toEqual({ flowId: "demo", endName: "Valid" });
    expect(kit.ui.history).toContainEqual({
      type: "patch",
      screen: "input",
      payload: { value: "12", error: "Minimum length is 4." },
    });
  });

  test("text input supports clear, backspace, barcode parse, cancel, timeout, and mask", async () => {
    const masked = createStandardStepTestKit({
      input: defineTextInputStep({
        id: "masked",
        screen: "input",
        value: { mask: true },
        sources: [InputSources.pinpad.numeric()],
        routes: { accepted: "Valid" },
      }),
    });
    const maskedRun = masked.flow.run("demo");
    for (const key of ["1", "2", "backspace", "3", "clear", "4", "enter"] as const) {
      masked.devices.pinpad.press(key);
      await flushPromises();
    }
    await expect(maskedRun).resolves.toEqual({ flowId: "demo", endName: "Valid" });
    expect(masked.ui.history).toContainEqual({
      type: "patch",
      screen: "input",
      payload: { value: "*", error: undefined },
    });

    const barcode = createStandardStepTestKit({
      input: defineTextInputStep({
        id: "barcode",
        screen: "input",
        sources: [
          InputSources.barcode.qr({
            parse: (text) =>
              text.startsWith("ok:")
                ? { ok: true, value: text.slice(3), autoSubmit: true }
                : { ok: false, error: "Invalid QR code" },
          }),
        ],
        routes: { accepted: "Valid" },
      }),
    });
    const barcodeRun = barcode.flow.run("demo");
    barcode.devices.barcodeReader.scan("bad");
    await flushPromises();
    barcode.devices.barcodeReader.scan("ok:998877");
    await expect(barcodeRun).resolves.toEqual({ flowId: "demo", endName: "Valid" });
    expect(barcode.ui.history).toContainEqual({
      type: "patch",
      screen: "input",
      payload: { value: "", error: "Invalid QR code" },
    });

    const cancelled = createStandardStepTestKit({
      input: defineTextInputStep({
        id: "cancel",
        screen: "input",
        sources: [InputSources.pinpad.numeric()],
        routes: { accepted: "Valid", cancelled: "Cancelled" },
      }),
    });
    const cancelRun = cancelled.flow.run("demo");
    cancelled.devices.pinpad.press("cancel");
    await expect(cancelRun).resolves.toEqual({ flowId: "demo", endName: "Cancelled" });

    const timedOut = createStandardStepTestKit({
      input: defineTextInputStep({
        id: "timeout",
        screen: "input",
        timeout: { key: "input", durationMs: 100 },
        sources: [InputSources.none()],
        routes: { accepted: "Valid", timeout: "Timeout" },
      }),
    });
    const timeoutRun = timedOut.flow.run("demo");
    await flushPromises();
    timedOut.clock.advanceBy(100);
    await expect(timeoutRun).resolves.toEqual({ flowId: "demo", endName: "Timeout" });
  });

  test("choice supports ui and pinpad routes with commit", async () => {
    const committed: string[] = [];
    const uiChoice = createStandardStepTestKit({
      input: defineChoiceStep({
        id: "choice",
        screen: "choice",
        choices: [
          { id: "saving", label: "Saving", route: "Saving" },
          { id: "checking", label: "Checking", route: "Checking" },
        ],
        commit: (_ctx, choice) => {
          committed.push(choice.id);
        },
      }),
    });
    const uiRun = uiChoice.flow.run("demo");
    await flushPromises();
    uiChoice.ui.emitAction("choice", { type: "choice", choiceId: "checking" });
    await expect(uiRun).resolves.toEqual({ flowId: "demo", endName: "Checking" });

    const pinpadChoice = createStandardStepTestKit({
      input: defineChoiceStep({
        id: "choice",
        screen: "choice",
        choices: [
          { id: "saving", label: "Saving", route: "Saving" },
          { id: "checking", label: "Checking", route: "Checking" },
        ],
      }),
    });
    const pinpadRun = pinpadChoice.flow.run("demo");
    pinpadChoice.devices.pinpad.press("f1");
    await expect(pinpadRun).resolves.toEqual({ flowId: "demo", endName: "Saving" });
    expect(committed).toEqual(["checking"]);
  });

  test("confirm routes confirmed, cancelled, and timeout", async () => {
    const confirmed = createStandardStepTestKit({
      input: defineConfirmStep({
        id: "confirm",
        screen: "confirm",
        routes: { confirmed: "Confirmed", cancelled: "Cancelled", timeout: "Timeout" },
      }),
    });
    const confirmedRun = confirmed.flow.run("demo");
    confirmed.devices.pinpad.press("enter");
    await expect(confirmedRun).resolves.toEqual({ flowId: "demo", endName: "Confirmed" });

    const cancelled = createStandardStepTestKit({
      input: defineConfirmStep({
        id: "confirm",
        screen: "confirm",
        routes: { confirmed: "Confirmed", cancelled: "Cancelled" },
      }),
    });
    const cancelRun = cancelled.flow.run("demo");
    await flushPromises();
    cancelled.ui.emitAction("confirm", { type: "cancel" });
    await expect(cancelRun).resolves.toEqual({ flowId: "demo", endName: "Cancelled" });

    const timedOut = createStandardStepTestKit({
      input: defineConfirmStep({
        id: "confirm",
        screen: "confirm",
        timeout: { key: "confirm", durationMs: 100 },
        sources: [InputSources.none()],
        routes: { confirmed: "Confirmed", timeout: "Timeout" },
      }),
    });
    const timeoutRun = timedOut.flow.run("demo");
    await flushPromises();
    timedOut.clock.advanceBy(100);
    await expect(timeoutRun).resolves.toEqual({ flowId: "demo", endName: "Timeout" });
  });

  test("host request and wait device skeletons map responses and failures", async () => {
    const host = createStandardStepTestKit({
      input: defineHostRequestStep({
        id: "host",
        request: async () => ({ approved: true }),
        route: (response: { approved: boolean }) => (response.approved ? "Approved" : "Declined"),
      }),
    });
    await expect(host.flow.run("demo")).resolves.toEqual({ flowId: "demo", endName: "Approved" });

    const wait = createStandardStepTestKit({
      input: defineWaitDeviceStep({
        id: "wait",
        wait: async () => ({ done: true }),
        route: () => "Done",
      }),
    });
    await expect(wait.flow.run("demo")).resolves.toEqual({ flowId: "demo", endName: "Done" });

    const failed = createStandardStepTestKit({
      input: defineHostRequestStep({
        id: "hostFailed",
        request: async () => {
          throw new Error("host down");
        },
        route: () => "Approved",
        routes: { failed: "Failed" },
      }),
    });
    await expect(failed.flow.run("demo")).resolves.toEqual({ flowId: "demo", endName: "Failed" });
  });
});

function createStandardStepTestKit(steps: Record<string, StepHandler>) {
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
          { id: "valid", type: "end", name: "Valid" },
          { id: "cancelled", type: "end", name: "Cancelled" },
          { id: "timeout", type: "end", name: "Timeout" },
          { id: "saving", type: "end", name: "Saving" },
          { id: "checking", type: "end", name: "Checking" },
          { id: "confirmed", type: "end", name: "Confirmed" },
          { id: "approved", type: "end", name: "Approved" },
          { id: "declined", type: "end", name: "Declined" },
          { id: "done", type: "end", name: "Done" },
          { id: "failed", type: "end", name: "Failed" },
        ],
        edges: [
          { id: "start-input", from: "start", to: "input" },
          { id: "valid", from: "input", to: "valid", route: "Valid" },
          { id: "cancelled", from: "input", to: "cancelled", route: "Cancelled" },
          { id: "timeout", from: "input", to: "timeout", route: "Timeout" },
          { id: "saving", from: "input", to: "saving", route: "Saving" },
          { id: "checking", from: "input", to: "checking", route: "Checking" },
          { id: "confirmed", from: "input", to: "confirmed", route: "Confirmed" },
          { id: "approved", from: "input", to: "approved", route: "Approved" },
          { id: "declined", from: "input", to: "declined", route: "Declined" },
          { id: "done", from: "input", to: "done", route: "Done" },
          { id: "failed", from: "input", to: "failed", route: "Failed" },
        ],
      },
    ],
  };
  const kit = createTestKioskApp(appOptions);
  return { ...kit, devices, clock };
}

async function flushPromises(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}
