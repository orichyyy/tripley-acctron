import { describe, expect, test } from "vitest";
import type { DeviceManager, ScreenMap, UiPort } from "@tripley-acctron/contracts";
import { InMemoryLogger } from "@tripley-acctron/observability";
import { DefaultRecoveryManager } from "./recovery-manager";
import { InMemoryTransactionResourceRegistry } from "./resource-registry";

describe("default recovery manager", () => {
  test("shows recovering UI, cancels devices, recovers resources, and clears transaction", async () => {
    const logger = new InMemoryLogger();
    const ui = new RecordingUi();
    const devices = createCancelableDevices();
    const resources = new InMemoryTransactionResourceRegistry(logger);
    const calls: string[] = [];
    const manager = new DefaultRecoveryManager({
      resources,
      logger,
      devices,
      ui,
      clearTransaction: async () => {
        calls.push("clear");
      },
    });

    resources.register("card", {
      onError: async () => {
        calls.push("card");
      },
    });

    await manager.recover({ reason: "unhandledError" });
    await resources.recover("unhandledError");

    expect(ui.history[0]).toEqual({
      type: "show",
      screen: "recovering",
      payload: { reason: "unhandledError" },
    });
    expect(cancelledDevices).toEqual([
      "pinpad",
      "barcodeReader",
      "cardReader",
      "cashDispenser",
      "printer",
    ]);
    expect(calls).toEqual(["card", "clear"]);
  });
});

const cancelledDevices: string[] = [];

class RecordingUi implements UiPort<ScreenMap> {
  public readonly history: Array<{ type: string; screen: string; payload: unknown }> = [];

  public async show<K extends keyof ScreenMap>(
    screen: K,
    state: ScreenMap[K]["state"],
  ): Promise<void> {
    this.history.push({ type: "show", screen: String(screen), payload: state });
  }

  public async patch<K extends keyof ScreenMap>(
    screen: K,
    patch: Partial<ScreenMap[K]["state"]>,
  ): Promise<void> {
    this.history.push({ type: "patch", screen: String(screen), payload: patch });
  }

  public async openDialog<K extends keyof ScreenMap>(
    screen: K,
    state: ScreenMap[K]["state"],
  ): Promise<void> {
    this.history.push({ type: "openDialog", screen: String(screen), payload: state });
  }

  public async closeDialog(): Promise<void> {}

  public async waitAction<K extends keyof ScreenMap>(): Promise<ScreenMap[K]["actions"]> {
    return {} as ScreenMap[K]["actions"];
  }
}

function createCancelableDevices(): DeviceManager {
  cancelledDevices.length = 0;
  const cancel = (name: string) => async () => {
    cancelledDevices.push(name);
  };
  return {
    pinpad: { waitKey: async () => "enter", cancel: cancel("pinpad") },
    barcodeReader: { read: async () => ({ text: "" }), cancel: cancel("barcodeReader") },
    cardReader: {
      waitForCard: async () => ({}),
      eject: async () => ({ taken: true }),
      retain: async () => {},
      cancel: cancel("cardReader"),
    },
    cashDispenser: {
      dispense: async (request) => ({ dispensed: true, amount: request.amount }),
      reject: async () => {},
      retract: async () => {},
      cancel: cancel("cashDispenser"),
    },
    printer: {
      print: async () => {},
      cut: async () => {},
      cancel: cancel("printer"),
    },
  };
}
