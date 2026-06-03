import { describe, expect, test } from "vitest";
import { HeadlessUiAdapter, createFakeDevices } from "@tripley-acctron/testing";
import { InMemoryLogger } from "@tripley-acctron/observability";
import type { InputSourceContext, ScreenMap } from "@tripley-acctron/contracts";
import { InputSources } from "./input-sources";

interface TestScreens extends ScreenMap {
  input: {
    state: { value: string };
    actions: { type: "submit"; value: string } | { type: "cancel" } | { type: "help" };
  };
}

describe("input sources", () => {
  test("pinpad numeric maps keys to intents and cancels on stop", async () => {
    const abort = new AbortController();
    const devices = createFakeDevices();
    const source = InputSources.pinpad.numeric();
    const session = await source.start(createContext({ signal: abort.signal, devices }));

    devices.pinpad.press("1");
    await expect(session.next()).resolves.toEqual({
      type: "append",
      text: "1",
      source: "pinpad.numeric",
    });

    devices.pinpad.press("enter");
    await expect(session.next()).resolves.toEqual({
      type: "submit",
      source: "pinpad.numeric",
    });

    devices.pinpad.press("cancel");
    await expect(session.next()).resolves.toEqual({
      type: "cancel",
      source: "pinpad.numeric",
    });

    await session.stop();
    expect(devices.pinpad.cancelled).toBe(true);
  });

  test("ui action maps submit, cancel, and generic actions", async () => {
    const abort = new AbortController();
    const ui = new HeadlessUiAdapter<TestScreens>();
    const session = await InputSources.ui
      .action("input")
      .start(createContext({ signal: abort.signal, ui }));

    const submit = session.next();
    ui.emitAction("input", { type: "submit", value: "123456" });
    await expect(submit).resolves.toEqual({
      type: "submit",
      value: "123456",
      source: "ui.action",
    });

    const cancel = session.next();
    ui.emitAction("input", { type: "cancel" });
    await expect(cancel).resolves.toEqual({ type: "cancel", source: "ui.action" });

    const generic = session.next();
    ui.emitAction("input", { type: "help" });
    await expect(generic).resolves.toEqual({
      type: "action",
      action: { type: "help" },
      source: "ui.action",
    });
  });

  test("barcode qr maps scan and cancels on stop", async () => {
    const abort = new AbortController();
    const devices = createFakeDevices();
    const session = await InputSources.barcode
      .qr()
      .start(createContext({ signal: abort.signal, devices }));

    const scan = session.next();
    devices.barcodeReader.scan("ACCOUNT:123456");

    await expect(scan).resolves.toEqual({
      type: "scan",
      text: "ACCOUNT:123456",
      source: "barcode.qr",
    });

    await session.stop();
    expect(devices.barcodeReader.cancelled).toBe(true);
  });

  test("aborted source wait rejects", async () => {
    const abort = new AbortController();
    const devices = createFakeDevices();
    const session = await InputSources.pinpad
      .numeric()
      .start(createContext({ signal: abort.signal, devices }));

    const intent = session.next();
    abort.abort(new Error("done"));

    await expect(intent).rejects.toThrow("done");
  });
});

function createContext(options: Partial<InputSourceContext>): InputSourceContext {
  return Object.assign(
    {
      signal: options.signal ?? new AbortController().signal,
      logger: new InMemoryLogger(),
    },
    options.ui ? { ui: options.ui } : {},
    options.devices ? { devices: options.devices } : {},
  );
}
