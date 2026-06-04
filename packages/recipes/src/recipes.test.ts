import { describe, expect, test } from "vitest";
import type { StepHandler, VoiceGuideOptions, VoiceGuideService } from "@tripley-acctron/contracts";
import {
  type TestKioskAppOptions,
  VirtualClock,
  createFakeDevices,
  createTestKioskApp,
} from "@tripley-acctron/testing";
import { Recipes } from "./recipes";

describe("recipes", () => {
  test("inputAccount accepts pinpad account and stores transaction value", async () => {
    const voiceGuide = new RecordingVoiceGuide();
    const kit = createRecipeKit(
      {
        input: Recipes.inputAccount({
          id: "input",
          screen: "account.input",
          saveAs: "accountNo",
          constraints: { minLength: 6, maxLength: 18 },
          routes: { valid: "Valid", cancel: "Cancelled", timeout: "Timeout" },
        }),
      },
      { voiceGuide },
    );

    const run = kit.flow.run("demo");
    await flushPromises();
    expect(voiceGuide.played).toEqual(["account.input"]);

    for (const key of ["1", "2", "3", "4", "5", "6", "enter"] as const) {
      kit.devices.pinpad.press(key);
      await flushPromises();
    }

    await expect(run).resolves.toEqual({ flowId: "demo", endName: "Valid" });
    expect(kit.transaction.get("accountNo")).toBe("123456");
  });

  test("inputAccount routes cancel, timeout, and barcode input", async () => {
    const cancelled = createRecipeKit({
      input: Recipes.inputAccount({
        id: "cancel",
        screen: "account.input",
        saveAs: "accountNo",
        voiceGuide: false,
        routes: { valid: "Valid", cancel: "Cancelled" },
      }),
    });
    const cancelRun = cancelled.flow.run("demo");
    cancelled.devices.pinpad.press("cancel");
    await expect(cancelRun).resolves.toEqual({ flowId: "demo", endName: "Cancelled" });

    const timedOut = createRecipeKit({
      input: Recipes.inputAccount({
        id: "timeout",
        screen: "account.input",
        saveAs: "accountNo",
        voiceGuide: false,
        timeout: { key: "account", durationMs: 100 },
        sources: { pinpad: false, barcodeQr: false, uiActions: false },
        routes: { valid: "Valid", timeout: "Timeout" },
      }),
    });
    const timeoutRun = timedOut.flow.run("demo");
    await flushPromises(12);
    timedOut.clock.advanceBy(100);
    await flushPromises();
    await expect(timeoutRun).resolves.toEqual({ flowId: "demo", endName: "Timeout" });

    const barcode = createRecipeKit({
      input: Recipes.inputAccount({
        id: "barcode",
        screen: "account.input",
        saveAs: "accountNo",
        voiceGuide: false,
        sources: {
          pinpad: false,
          uiActions: false,
          barcodeQr: {
            parse: (text) => ({ ok: true, value: text, autoSubmit: true }),
          },
        },
        routes: { valid: "Valid" },
      }),
    });
    const barcodeRun = barcode.flow.run("demo");
    barcode.devices.barcodeReader.scan("998877");
    await expect(barcodeRun).resolves.toEqual({ flowId: "demo", endName: "Valid" });
    expect(barcode.transaction.get("accountNo")).toBe("998877");
  });

  test("waitCardInserted maps inserted, timeout, and error routes", async () => {
    const inserted = createRecipeKit({
      input: Recipes.waitCardInserted({
        id: "waitCard",
        routes: { inserted: "Inserted", timeout: "Timeout", error: "Error" },
      }),
    });
    const insertedRun = inserted.flow.run("demo");
    inserted.devices.cardReader.insert({ pan: "4111111111111111" });
    await expect(insertedRun).resolves.toEqual({ flowId: "demo", endName: "Inserted" });

    const timedOut = createRecipeKit({
      input: Recipes.waitCardInserted({
        id: "waitCard",
        timeout: { key: "card", durationMs: 100 },
        routes: { inserted: "Inserted", timeout: "Timeout", error: "Error" },
      }),
    });
    const timeoutRun = timedOut.flow.run("demo");
    await flushPromises(12);
    timedOut.clock.advanceBy(100);
    await flushPromises();
    await expect(timeoutRun).resolves.toEqual({ flowId: "demo", endName: "Timeout" });
  });

  test("ejectCard maps taken, retained, and failed routes", async () => {
    const taken = createRecipeKit({
      input: Recipes.ejectCard({
        id: "eject",
        screen: "card.take",
        routes: { taken: "Success", retained: "Retained", failed: "Failed" },
      }),
    });
    await expect(taken.flow.run("demo")).resolves.toEqual({ flowId: "demo", endName: "Success" });

    const retained = createRecipeKit({
      input: Recipes.ejectCard({
        id: "eject",
        routes: { taken: "Success", retained: "Retained", failed: "Failed" },
      }),
    });
    retained.devices.cardReader.ejectResult = { taken: false };
    await expect(retained.flow.run("demo")).resolves.toEqual({
      flowId: "demo",
      endName: "Retained",
    });
    expect(retained.devices.cardReader.retainedReasons).toEqual(["card.notTaken"]);
  });
});

function createRecipeKit(
  steps: Record<string, StepHandler>,
  options: { voiceGuide?: VoiceGuideService } = {},
) {
  const devices = createFakeDevices();
  const clock = new VirtualClock();
  const appOptions: TestKioskAppOptions = {
    flows: [
      {
        id: "demo",
        version: "1",
        nodes: [
          { id: "start", type: "start" },
          { id: "input", type: "action", action: "input" },
          { id: "valid", type: "end", name: "Valid" },
          { id: "inserted", type: "end", name: "Inserted" },
          { id: "success", type: "end", name: "Success" },
          { id: "cancelled", type: "end", name: "Cancelled" },
          { id: "timeout", type: "end", name: "Timeout" },
          { id: "retained", type: "end", name: "Retained" },
          { id: "failed", type: "end", name: "Failed" },
        ],
        edges: [
          { id: "e0", from: "start", to: "input" },
          { id: "e1", from: "input", to: "valid", route: "Valid" },
          { id: "e2", from: "input", to: "inserted", route: "Inserted" },
          { id: "e3", from: "input", to: "success", route: "Success" },
          { id: "e4", from: "input", to: "cancelled", route: "Cancelled" },
          { id: "e5", from: "input", to: "timeout", route: "Timeout" },
          { id: "e6", from: "input", to: "retained", route: "Retained" },
          { id: "e7", from: "input", to: "failed", route: "Failed" },
        ],
      },
    ],
    steps,
    devices,
    clock,
  };
  if (options.voiceGuide) {
    appOptions.voiceGuide = options.voiceGuide;
  }
  const kit = createTestKioskApp(appOptions);
  return { ...kit, devices, clock };
}

async function flushPromises(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

class RecordingVoiceGuide implements VoiceGuideService {
  public readonly played: string[] = [];

  public async play(key: string, _options?: VoiceGuideOptions): Promise<void> {
    this.played.push(key);
  }

  public async stop(): Promise<void> {}
}
