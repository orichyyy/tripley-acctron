import { describe, expect, test } from "vitest";
import { HeadlessUiAdapter, VirtualClock, createFakeDevices } from "@tripley-acctron/testing";
import { InMemoryLogger } from "@tripley-acctron/observability";
import type {
  InteractionIntent,
  InteractionReducerContext,
  InteractionReducerResult,
  ScreenMap,
} from "@tripley-acctron/contracts";
import { DefaultTimeoutService } from "./timeout-service";
import { InputSources } from "./input-sources";
import { InteractionRuntime } from "./interaction-runtime";

interface TestScreens extends ScreenMap {
  input: {
    state: { value: string };
    actions: { type: "submit"; value?: string } | { type: "cancel" };
  };
  "dialog.moreTime": {
    state: { remainingSeconds: number };
    actions: { type: "yes" } | { type: "no" };
  };
}

describe("interaction runtime", () => {
  test("renders initial state, patches after append, and accepts submit", async () => {
    const ui = new HeadlessUiAdapter<TestScreens>();
    const devices = createFakeDevices();
    const audit: InteractionIntent[] = [];
    const runtime = new InteractionRuntime<TestScreens>({
      ui,
      devices,
      logger: new InMemoryLogger(),
    });

    const run = runtime.run(createTextInputOptions({ audit }));

    devices.pinpad.press("1");
    await Promise.resolve();
    devices.pinpad.press("2");
    await Promise.resolve();
    devices.pinpad.press("enter");

    await expect(run).resolves.toEqual({ type: "accepted", value: "12" });
    expect(ui.history).toContainEqual({ type: "show", screen: "input", payload: { value: "" } });
    expect(ui.history).toContainEqual({ type: "patch", screen: "input", payload: { value: "1" } });
    expect(ui.history).toContainEqual({ type: "patch", screen: "input", payload: { value: "12" } });
    expect(audit.map((intent) => intent.type)).toEqual(["append", "append", "submit"]);
    expect(devices.pinpad.cancelled).toBe(true);
  });

  test("first input source intent wins across ui and barcode", async () => {
    const ui = new HeadlessUiAdapter<TestScreens>();
    const devices = createFakeDevices();
    const runtime = new InteractionRuntime<TestScreens>({
      ui,
      devices,
      logger: new InMemoryLogger(),
    });

    const run = runtime.run(createTextInputOptions());
    devices.barcodeReader.scan("SCAN-42");

    await expect(run).resolves.toEqual({ type: "accepted", value: "SCAN-42" });
    expect(devices.pinpad.cancelled).toBe(true);
    expect(devices.barcodeReader.cancelled).toBe(true);
  });

  test("cancel intent resolves cancelled", async () => {
    const ui = new HeadlessUiAdapter<TestScreens>();
    const devices = createFakeDevices();
    const runtime = new InteractionRuntime<TestScreens>({
      ui,
      devices,
      logger: new InMemoryLogger(),
    });

    const run = runtime.run(createTextInputOptions());
    await flushPromises();
    ui.emitAction("input", { type: "cancel" });

    await expect(run).resolves.toEqual({ type: "cancelled" });
  });

  test("timeout resolves timeout", async () => {
    const ui = new HeadlessUiAdapter<TestScreens>();
    const clock = new VirtualClock();
    const timeoutService = new DefaultTimeoutService({ clock, ui });
    const runtime = new InteractionRuntime<TestScreens>({
      ui,
      logger: new InMemoryLogger(),
      timeoutService,
    });

    const run = runtime.run({
      ...createTextInputOptions(),
      sources: () => [InputSources.none()],
      timeout: { key: "input", durationMs: 100 },
    });
    await flushPromises();
    clock.advanceBy(100);

    await expect(run).resolves.toEqual({ type: "timeout" });
  });

  test("more time yes continues and later input accepts", async () => {
    const ui = new HeadlessUiAdapter<TestScreens>();
    const devices = createFakeDevices();
    const clock = new VirtualClock();
    const timeoutService = new DefaultTimeoutService({ clock, ui });
    const runtime = new InteractionRuntime<TestScreens>({
      ui,
      devices,
      logger: new InMemoryLogger(),
      timeoutService,
    });

    const run = runtime.run({
      ...createTextInputOptions(),
      timeout: {
        key: "input",
        durationMs: 100,
        policy: "askMoreTime",
        moreTime: { dialog: "dialog.moreTime", extensionMs: 200 },
      },
    });

    await flushPromises();
    clock.advanceBy(100);
    await Promise.resolve();
    ui.emitAction("dialog.moreTime", { type: "yes" });
    await Promise.resolve();
    devices.pinpad.press("9");
    await Promise.resolve();
    devices.pinpad.press("enter");

    await expect(run).resolves.toEqual({ type: "accepted", value: "9" });
  });
});

function createTextInputOptions(options: { audit?: InteractionIntent[] } = {}) {
  return {
    screen: "input" as const,
    initialState: { value: "" },
    render: (state: { value: string }) => state,
    sources: () => [
      InputSources.pinpad.numeric(),
      InputSources.barcode.qr(),
      InputSources.ui.action("input"),
    ],
    auditIntent: (intent: InteractionIntent) => {
      options.audit?.push(intent);
    },
    reduce: (
      state: { value: string },
      intent: InteractionIntent,
      ctx: InteractionReducerContext<{ value: string }, string>,
    ): InteractionReducerResult<{ value: string }, string> => {
      if (intent.type === "append") {
        return ctx.update({ value: state.value + intent.text });
      }
      if (intent.type === "scan") {
        return ctx.accept(intent.text);
      }
      if (intent.type === "submit") {
        return ctx.accept(typeof intent.value === "string" ? intent.value : state.value);
      }
      if (intent.type === "cancel") {
        return ctx.cancel();
      }
      return ctx.update(state);
    },
  };
}

async function flushPromises(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}
